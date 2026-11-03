"""Spark 배치 J1(HDFS 적재) 시험 — Kafka·HDFS·DB 없이 (D-33).

임시 폴더 열 만들기·중복 빼기·세션 폴더 쓰기·feature_archive 행을 로컬 Spark와 로컬 파일 시스템으로 확인한다
(pyspark가 없으면 건너뜀). Kafka 받기(Structured Streaming)와 실제 HDFS·DB는 통합 테스트 17단계가 확인한다.
"""

import datetime as dt
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bigdata" / "jobs"))

import j1_hdfs_archive as job  # noqa: E402

try:
    from pyspark.sql import SparkSession
except ImportError:  # pragma: no cover
    SparkSession = None

S1 = "11111111-1111-4111-8111-111111111111"
S2 = "22222222-2222-4222-8222-222222222222"


def msg(session, kind, body, mid):
    return json.dumps({"schema_version": "1.0", "message_id": f"00000000-0000-4000-8000-{mid:012d}",
                       "session_id": session, "user_id": "synthetic", "produced_at": "2026-11-01T01:00:00Z",
                       "kind": kind, "body": body})


def kafka_rows():
    """(topic, partition, offset, value, timestamp) — S1 은 중복 포함, S2 는 다른 세션."""
    ts = dt.datetime(2026, 11, 1, 10, 0, 0)
    f, i, e = "posture.features.v1", "posture.inference.v1", "posture.episodes.v1"
    rows, n = [], 0

    def add(topic, value):
        nonlocal n
        n += 1
        rows.append((topic, 0, n, value.encode(), ts))
    add(f, msg(S1, "session_started", {"policy": {}}, 1))
    for seq in range(3):
        add(f, msg(S1, "features", {"sequence": seq, "start_ms": 500 * seq + 1000, "end_ms": 500 * seq + 1500}, 10 + seq))
    add(f, msg(S1, "features", {"sequence": 1, "start_ms": 1500, "end_ms": 2000}, 99))  # 재전송(다른 message_id)
    add(f, msg(S1, "session_ended", {"end_ms": 3000}, 2))
    for seq in range(3):
        add(i, msg(S1, "observation", {"sequence": seq, "start_ms": 500 * seq + 1000, "end_ms": 500 * seq + 1500}, 20 + seq))
    add(e, msg(S1, "decision", {"last_sequence": 1, "event": {"event_id": 1}}, 30))
    add(e, msg(S1, "decision", {"last_sequence": 1, "event": {"event_id": 1}}, 31))  # 같은 사건 재발행
    add(e, msg(S1, "progress", {"last_sequence": 2}, 32))
    add(e, msg(S1, "progress", {"last_sequence": 2}, 33))  # progress는 message_id가 다르면 둘 다 남김
    add(f, msg(S2, "features", {"sequence": 0, "start_ms": 0, "end_ms": 500}, 40))
    return rows


class LocalHdfs:
    """batch_common.Hdfs와 같은 메서드 — 경로를 임시 폴더 아래로."""

    def __init__(self, root):
        self.root = Path(root)
        self.uri = "file://" + str(self.root)

    def _p(self, path):
        return self.root / path.lstrip("/")

    def exists(self, path):
        return self._p(path).exists()

    def delete(self, path):
        p = self._p(path)
        if p.exists():
            shutil.rmtree(p)
            return True
        return False

    def list_dirs(self, path):
        p = self._p(path)
        return [("/" + str(c.relative_to(self.root))) for c in p.iterdir() if c.is_dir()] if p.exists() else []

    def write_text(self, path, text):
        p = self._p(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


class FakeJdbc:
    def __init__(self, candidates):
        self.candidates = candidates
        self.inserts = []
        self.commits = 0

    def query(self, sql, params=()):
        return self.candidates

    def execute(self, sql, params=()):
        self.inserts.append(list(params))
        return 1

    def commit(self):
        self.commits += 1


class Args:
    session = []
    settle_sec = 600
    keep_days = 7
    dry_run = False


@unittest.skipIf(SparkSession is None, "pyspark 없음")
class J1OrganizeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spark = (SparkSession.builder.master("local[1]").appName("j1-test")
                     .config("spark.ui.enabled", "false").config("spark.sql.shuffle.partitions", "2")
                     .config("spark.sql.session.timeZone", "Asia/Seoul").getOrCreate())
        cls.spark.sparkContext.setLogLevel("ERROR")

    @classmethod
    def tearDownClass(cls):
        cls.spark.stop()

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.hdfs = LocalHdfs(self.tmp)
        raw = self.spark.createDataFrame(kafka_rows(), "topic string, partition int, offset long, value binary, timestamp timestamp")
        staged = job.staging_columns(raw)
        staged.write.partitionBy("topic", "date").parquet(self.hdfs.uri + job.STAGING)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_staging_columns_extract_envelope(self):
        raw = self.spark.createDataFrame(kafka_rows()[:1], "topic string, partition int, offset long, value binary, timestamp timestamp")
        r = job.staging_columns(raw).collect()[0]
        self.assertEqual((r["session_id"], r["kind"], r["date"]), (S1, "session_started", "2026-11-01"))

    def test_organize_writes_three_files_dedupes_and_inserts_row(self):
        cand = {"monitor_session_id": "5", "client_session_uuid": S1, "user_account_id": "7",
                "started_at": "2026-11-01 10:00:00.000000"}
        jdbc = FakeJdbc([cand, dict(cand, client_session_uuid="33333333-3333-4333-8333-333333333333")])
        done, missing, total = job.organize(self.spark, jdbc, self.hdfs, Args(), dt.datetime(2026, 11, 1, 11, 0))
        self.assertEqual(total, 2)
        self.assertEqual(missing, ["33333333-3333-4333-8333-333333333333"])  # 임시 폴더에 없는 세션
        folder = f"/data/users/7/2026-11-01/{S1}/"
        self.assertEqual(done[0]["folder"], folder)
        self.assertEqual(done[0]["lines"], {"features.jsonl": 5, "inference.jsonl": 3, "episodes.jsonl": 3})
        features = (self.hdfs.root / folder.lstrip("/") / "features.jsonl").read_text().splitlines()
        self.assertEqual([json.loads(x)["kind"] for x in features],
                         ["session_started", "features", "features", "features", "session_ended"])
        self.assertNotIn("000000000099", "".join(features))  # 재전송은 빠짐(앞 offset만)
        self.assertEqual(jdbc.inserts[0], [5, folder, "2026-11-01 10:00:01.000", "2026-11-01 10:00:02.500",
                                           jdbc.inserts[0][4]])
        self.assertEqual(jdbc.commits, 1)

    def test_dry_run_writes_nothing(self):
        cand = {"monitor_session_id": "5", "client_session_uuid": S1, "user_account_id": "7",
                "started_at": "2026-11-01 10:00:00.000000"}
        args = Args()
        args.dry_run = True
        jdbc = FakeJdbc([cand])
        done, _, _ = job.organize(self.spark, jdbc, self.hdfs, args, dt.datetime(2026, 11, 1, 11, 0))
        self.assertEqual(done[0]["lines"]["features.jsonl"], 5)
        self.assertEqual(jdbc.inserts, [])
        self.assertFalse(self.hdfs.exists("/data/users"))

    def test_clean_staging_removes_only_old_dates(self):
        self.hdfs.write_text(job.STAGING + "/topic=posture.features.v1/date=2026-10-20/x.parquet", "")
        removed = job.clean_staging(self.hdfs, dt.date(2026, 11, 1), 7)
        self.assertEqual(removed, [job.STAGING + "/topic=posture.features.v1/date=2026-10-20"])
        self.assertTrue(self.hdfs.exists(job.STAGING + "/topic=posture.features.v1/date=2026-11-01"))


class J1PureTest(unittest.TestCase):
    def test_candidates_sql(self):
        sql = job.candidates_sql("c", "s", [S1])
        self.assertIn("m.ended_at IS NOT NULL AND m.ended_at <= ?", sql)
        self.assertIn("u.account_status = 'ACTIVE'", sql)
        self.assertIn("NOT EXISTS (SELECT 1 FROM feature_archive", sql)
        self.assertIn("m.client_session_uuid IN (?)", sql)

    def test_kst_plus_ms_and_folder(self):
        self.assertEqual(job.kst_plus_ms("2026-11-01 23:59:59.500000", 1500), "2026-11-02 00:00:01.000")
        self.assertEqual(job.session_folder(7, "2026-11-01 23:59:59.500", S1), f"/data/users/7/2026-11-01/{S1}/")

    def test_bootstrap_default_and_override(self):
        self.assertEqual(job.kafka_bootstrap({}), "kafka:19092")
        self.assertEqual(job.kafka_bootstrap({"KAFKA_BOOTSTRAP_SERVERS": "k:1"}), "k:1")

    def test_session_must_be_uuid(self):
        with self.assertRaises(SystemExit):
            job.main(["--session", "abc"])


if __name__ == "__main__":
    unittest.main()
