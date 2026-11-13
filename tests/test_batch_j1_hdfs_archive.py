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

    def test_keypoints_are_a_fourth_file_deduped_by_sequence(self):
        """(D-92) 좌표 구간 토픽이 있는 세션은 keypoints.jsonl도 — 순번으로 중복을 빼고, 구간 범위는 features로 정한다."""
        ts = dt.datetime(2026, 11, 1, 10, 0, 0)
        k = "posture.keypoints.v1"
        frames = [{"t_ms": 1000, "p": [[0.5, 0.4, 0.9]] * 9}]
        rows = [(k, 0, 200 + n, msg(S1, "keypoints", {"sequence": seq, "start_ms": 500 * seq + 1000,
                                                      "end_ms": 500 * seq + 1500, "frames": frames}, 50 + n).encode(), ts)
                for n, seq in enumerate([0, 1, 1, 2])]  # 순번 1 재전송
        raw = self.spark.createDataFrame(rows, "topic string, partition int, offset long, value binary, timestamp timestamp")
        job.staging_columns(raw).write.partitionBy("topic", "date").parquet(self.hdfs.uri + job.KEYPOINTS_STAGING)
        cand = {"monitor_session_id": "5", "client_session_uuid": S1, "user_account_id": "7",
                "started_at": "2026-11-01 10:00:00.000000"}
        jdbc = FakeJdbc([cand])
        done, _, _ = job.organize(self.spark, jdbc, self.hdfs, Args(), dt.datetime(2026, 11, 1, 11, 0))
        self.assertEqual(done[0]["lines"], {"features.jsonl": 5, "inference.jsonl": 3, "episodes.jsonl": 3,
                                            "keypoints.jsonl": 3})
        folder = self.hdfs.root / f"data/users/7/2026-11-01/{S1}"
        keypoints = (folder / "keypoints.jsonl").read_text().splitlines()
        self.assertEqual([json.loads(x)["body"]["sequence"] for x in keypoints], [0, 1, 2])
        self.assertEqual(jdbc.inserts[0][2:4], ["2026-11-01 10:00:01.000", "2026-11-01 10:00:02.500"])

    def test_session_without_keypoints_has_no_keypoints_file(self):
        cand = {"monitor_session_id": "5", "client_session_uuid": S1, "user_account_id": "7",
                "started_at": "2026-11-01 10:00:00.000000"}
        job.organize(self.spark, FakeJdbc([cand]), self.hdfs, Args(), dt.datetime(2026, 11, 1, 11, 0))
        self.assertFalse(self.hdfs.exists(f"/data/users/7/2026-11-01/{S1}/keypoints.jsonl"))

    def test_two_staging_streams_both_write(self):
        """(D-92 회귀) 판정 과정·좌표 쿼리가 각자 임시 폴더에 쓴다 — 같은 폴더였을 때는 뒤 쿼리가 아무것도 못 썼다(11/13)."""
        schema = "topic string, partition int, offset long, value binary, timestamp timestamp"
        src = Path(self.tmp) / "src"
        rows = kafka_rows()
        uri, main_root = self.hdfs.uri, "/data/staging/main-test"
        main_rows = 0
        for _ in range(2):  # 판정 과정 쿼리를 두 번(같은 체크포인트) 돌려 그 폴더의 배치 번호를 앞서게 한다
            self.spark.createDataFrame(rows[:4], schema).write.mode("append").parquet(str(src / "main"))
            stream = self.spark.readStream.schema(schema).parquet(str(src / "main"))
            main_rows += job.stage_stream(stream, uri, main_root, "/data/checkpoints/main-test")
        kp = [("posture.keypoints.v1",) + r[1:] for r in rows[:2]]
        self.spark.createDataFrame(kp, schema).write.parquet(str(src / "kp"))

        def kp_stream():
            return self.spark.readStream.schema(schema).parquet(str(src / "kp"))
        # 예전 방식(같은 임시 폴더, 새 체크포인트) — 배치 0이 「이미 쓴 배치」로 건너뛰어져 읽은 수 0
        self.assertEqual(job.stage_stream(kp_stream(), uri, main_root, "/data/checkpoints/kp-shared"), 0)
        # 지금 방식(따로 둔 임시 폴더) — 다 쓴다
        kp_rows = job.stage_stream(kp_stream(), uri, job.KEYPOINTS_STAGING, "/data/checkpoints/kp-test")
        self.assertEqual((main_rows, kp_rows), (8, 2))
        self.assertEqual(self.spark.read.parquet(uri + job.KEYPOINTS_STAGING).count(), 2)

    def test_deleted_checkpoint_with_leftover_sink_metadata_is_reset(self):
        """(D-93 회귀) 체크포인트만 지우면 남은 _spark_metadata 때문에 새 쿼리가 0건이 된다 — 받기 전에 메타데이터를 지운다."""
        schema = "topic string, partition int, offset long, value binary, timestamp timestamp"
        src = Path(self.tmp) / "src-reset"
        uri, root, ck = self.hdfs.uri, "/data/staging/reset-test", "/data/checkpoints/reset-test"
        for _ in range(3):  # 배치 번호를 앞서게(메타데이터 0·1·2)
            self.spark.createDataFrame(kafka_rows()[:2], schema).write.mode("append").parquet(str(src))
            job.stage_stream(self.spark.readStream.schema(schema).parquet(str(src)), uri, root, ck)
        self.hdfs.delete(ck)  # 운영자가 처음부터 다시 받으려고 체크포인트만 지움

        def again():
            return job.stage_stream(self.spark.readStream.schema(schema).parquet(str(src)), uri, root, ck)
        self.assertEqual(again(), 0)  # 예전 동작: 남은 메타데이터 때문에 배치 0이 건너뛰어짐
        self.hdfs.delete(ck)
        self.assertTrue(job.reset_orphan_sink_log(self.hdfs, root, ck))
        self.assertEqual(again(), 6)  # 지금: 메타데이터를 지운 뒤 처음부터 다 받음
        self.assertFalse(job.reset_orphan_sink_log(self.hdfs, root, ck))  # 체크포인트가 있으면 건드리지 않음

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
        self.hdfs.write_text(job.KEYPOINTS_STAGING + "/topic=posture.keypoints.v1/date=2026-10-20/x.parquet", "")
        removed = job.clean_staging(self.hdfs, dt.date(2026, 11, 1), 7)
        self.assertEqual(removed, [job.STAGING + "/topic=posture.features.v1/date=2026-10-20",
                                   job.KEYPOINTS_STAGING + "/topic=posture.keypoints.v1/date=2026-10-20"])
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

    def test_keypoints_topic_is_read_with_its_own_checkpoint(self):
        """(D-92) 기존 체크포인트의 구독 목록은 그대로 — 좌표 토픽은 따로."""
        self.assertNotIn("posture.keypoints.v1", job.TOPICS)
        self.assertEqual(set(job.ALL_TOPICS), set(job.TOPICS) | {"posture.keypoints.v1"})
        self.assertNotEqual(job.KEYPOINTS_CHECKPOINT, job.CHECKPOINT)
        # 임시 폴더도 따로 — 같은 폴더(같은 _spark_metadata)면 뒤 쿼리의 배치가 건너뛰어져 아무것도 쓰지 않는다(11/13 서버)
        for a, b in ((job.STAGING, job.KEYPOINTS_STAGING), (job.KEYPOINTS_STAGING, job.STAGING)):
            self.assertFalse((b + "/").startswith(a + "/"))
        self.assertEqual(job.staging_root("posture.keypoints.v1"), job.KEYPOINTS_STAGING)
        self.assertEqual(job.staging_root("posture.features.v1"), job.STAGING)

    def test_bootstrap_default_and_override(self):
        self.assertEqual(job.kafka_bootstrap({}), "kafka:19092")
        self.assertEqual(job.kafka_bootstrap({"KAFKA_BOOTSTRAP_SERVERS": "k:1"}), "k:1")

    def test_session_must_be_uuid(self):
        with self.assertRaises(SystemExit):
            job.main(["--session", "abc"])


if __name__ == "__main__":
    unittest.main()
