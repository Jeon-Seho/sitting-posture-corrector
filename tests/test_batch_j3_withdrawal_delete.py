"""Spark 배치 J3(탈퇴 최종 삭제) 흐름 시험 — 가짜 DB·HDFS로, Spark 없이 (D-49).

서버 확인은 통합 테스트 16단계가 실제 DB·HDFS로 한다.
"""

import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bigdata" / "jobs"))

import j3_withdrawal_delete as job  # noqa: E402


class FakeHdfs:
    uri = "hdfs://hdfs-namenode:9000"

    def __init__(self, paths=()):
        self.paths = set(paths)
        self.deleted = []

    def exists(self, path):
        return any(p == path or p.startswith(path + "/") for p in self.paths)

    def delete(self, path):
        self.deleted.append(path)
        before = len(self.paths)
        self.paths = {p for p in self.paths if not (p == path or p.startswith(path + "/"))}
        return len(self.paths) != before


class FakeJdbc:
    """SQL 첫 단어·테이블로 동작을 흉내 낸다. fail_on: 이 테이블 DELETE에서 예외."""

    def __init__(self, archives=(), fail_on=None, claim=1, account=1):
        self.archives = list(archives)
        self.fail_on = fail_on
        self.claim = claim
        self.account = account
        self.log = []  # (동작, 내용)

    def query(self, sql, params=()):
        self.log.append(("query", sql.split(" FROM ")[1].split()[0]))
        if "feature_archive" in sql:
            return self.archives
        return []

    def execute(self, sql, params=()):
        words = sql.split()
        if words[0] == "UPDATE":
            table = words[1]
            if table == "deletion_request" and "'PROCESSING'," in sql:
                self.log.append(("claim", params[0]))
                return self.claim
            if table == "deletion_request":
                self.log.append(("failed", params[0]))
                return 1
            self.log.append(("archived", list(params)))
            return len(params) - 1
        table = words[2] if words[1] == "FROM" else words[3]
        if table == self.fail_on:
            raise RuntimeError(f"{table} 실패")
        self.log.append(("delete", table))
        return self.account if table == "user_account" else 2

    def commit(self):
        self.log.append(("commit", None))

    def rollback(self):
        self.log.append(("rollback", None))


TARGET = {"user_account_id": 7, "requested_at": "2026-09-01 10:00:00.000", "request_status": "REQUESTED"}
NOW = "2026-11-01 04:00:00.000"


class J3FlowTest(unittest.TestCase):
    def test_cutoff_is_closed_at_plus_grace(self):
        now = dt.datetime(2026, 11, 1, 4, 0, 0, tzinfo=job.bc.KST)
        self.assertEqual(job.cutoff_text(now, 30), "2026-10-02 04:00:00.000")
        self.assertEqual(job.cutoff_text(now, 0), "2026-11-01 04:00:00.000")

    def test_targets_sql_scope_status_and_user_filter(self):
        sql = job.targets_sql([7, 8])
        self.assertIn("request_scope = 'ACCOUNT_ALL'", sql)
        self.assertIn("account_closed_at <= ?", sql)
        self.assertIn("('REQUESTED', 'FAILED', 'PROCESSING')", sql)
        self.assertIn("user_account_id IN (?,?)", sql)

    def test_success_order_files_first_then_rows_bottom_up(self):
        hdfs = FakeHdfs({"/data/users/7/2026-08-30/s1/a.parquet", "/data/users/70/x"})
        jdbc = FakeJdbc(archives=[{"feature_archive_id": "11", "file_uri": "/data/users/7/2026-08-30/s1/",
                                   "deleted_at": None}])
        done, failed = job.run(jdbc, hdfs, [TARGET], NOW, notify=lambda uid: None)
        self.assertEqual(failed, [])
        self.assertEqual(done[0]["files"], ["/data/users/7"])
        self.assertEqual(hdfs.paths, {"/data/users/70/x"})  # 다른 사용자(70) 폴더는 그대로
        kinds = [k for k, _ in jdbc.log if k != "query"]
        self.assertEqual(kinds[:4], ["claim", "commit", "archived", "commit"])
        self.assertEqual([t for k, t in jdbc.log if k == "delete"],
                         ["feature_archive", "monitor_session", "daily_stat", "baseline_posture",
                          "deletion_request", "user_account"])
        self.assertEqual(jdbc.log[-1], ("commit", None))
        self.assertEqual([v for k, v in jdbc.log if k == "archived"][0], [NOW, 11])  # deleted_at = 실행 시각

    def test_failure_rolls_back_rows_and_marks_failed_but_keeps_file_progress(self):
        hdfs = FakeHdfs({"/data/users/7/d/s/x"})
        jdbc = FakeJdbc(archives=[{"feature_archive_id": "11", "file_uri": "/data/users/7/d/s/",
                                   "deleted_at": None}], fail_on="daily_stat")
        notified = []
        done, failed = job.run(jdbc, hdfs, [TARGET], NOW, notify=notified.append)
        self.assertEqual(done, [])
        self.assertEqual(failed[0]["user_account_id"], 7)
        self.assertIn("daily_stat", failed[0]["reason"])
        self.assertEqual(notified, [])  # 실패면 안내 안 함
        tail = [k for k, _ in jdbc.log][-3:]
        self.assertEqual(tail, ["rollback", "failed", "commit"])
        # 파일 삭제·deleted_at은 그 전에 확정됐다(재시도 지점)
        self.assertLess([k for k, _ in jdbc.log].index("archived"), [k for k, _ in jdbc.log].index("rollback"))

    def test_retry_after_files_gone_skips_already_deleted_archive(self):
        hdfs = FakeHdfs()
        jdbc = FakeJdbc(archives=[{"feature_archive_id": "11", "file_uri": "/data/users/7/d/s/",
                                   "deleted_at": "2026-11-01 04:00:00"}])
        done, failed = job.run(jdbc, hdfs, [dict(TARGET, request_status="FAILED")], NOW, notify=lambda uid: None)
        self.assertEqual((len(done), failed), (1, []))
        self.assertEqual(done[0]["files"], [])
        self.assertNotIn("archived", [k for k, _ in jdbc.log])

    def test_archive_outside_own_folder_is_refused(self):
        hdfs = FakeHdfs({"/data/users/8/d/s/x"})
        jdbc = FakeJdbc(archives=[{"feature_archive_id": "11", "file_uri": "hdfs://hdfs-namenode:9000/data/users/8/d/s/",
                                   "deleted_at": None}])
        done, failed = job.run(jdbc, hdfs, [TARGET], NOW, notify=lambda uid: None)
        self.assertEqual(done, [])
        self.assertIn("폴더 밖", failed[0]["reason"])
        self.assertEqual(hdfs.paths, {"/data/users/8/d/s/x"})

    def test_account_not_closed_fails_whole_transaction(self):
        jdbc = FakeJdbc(account=0)
        done, failed = job.run(jdbc, FakeHdfs(), [TARGET], NOW, notify=lambda uid: None)
        self.assertEqual(done, [])
        self.assertIn("CLOSED", failed[0]["reason"])
        self.assertIn("rollback", [k for k, _ in jdbc.log])

    def test_claim_zero_means_skip(self):
        jdbc = FakeJdbc(claim=0)
        done, failed = job.run(jdbc, FakeHdfs(), [TARGET], NOW, notify=lambda uid: None)
        self.assertEqual((done, failed), ([], []))
        self.assertNotIn("delete", [k for k, _ in jdbc.log])

    def test_one_failure_does_not_stop_next_user(self):
        class Flaky(FakeJdbc):
            def execute(self, sql, params=()):
                if sql.startswith("DELETE FROM daily_stat") and params == (7,):
                    raise RuntimeError("boom")
                return super().execute(sql, params)
        jdbc = Flaky()
        done, failed = job.run(jdbc, FakeHdfs(), [TARGET, dict(TARGET, user_account_id=9)], NOW,
                               notify=lambda uid: None)
        self.assertEqual([d["user_account_id"] for d in done], [9])
        self.assertEqual([f["user_account_id"] for f in failed], [7])

    def test_hdfs_path_from_uri(self):
        self.assertEqual(job.hdfs_path("hdfs://hdfs-namenode:9000/data/users/7/d/s/"), "/data/users/7/d/s")
        self.assertEqual(job.hdfs_path("/data/users/7/d/s/"), "/data/users/7/d/s")

    def test_grace_days_requires_user(self):
        with self.assertRaises(SystemExit):
            job.main(["--grace-days", "0"])


if __name__ == "__main__":
    unittest.main()
