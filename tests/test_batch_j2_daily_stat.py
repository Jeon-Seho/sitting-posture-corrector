"""Spark 배치 J2(일별 통계) 계산 시험 — 합성 세션만, DB 없이 로컬 Spark로 (D-05).

pyspark가 없으면 건너뛴다(팀 make check 환경). 서버 확인은 통합 테스트 15단계가 실제 DB로 한다.
값은 0.1초 단위 정수(ds)로 비교한다.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bigdata" / "jobs"))

try:
    from pyspark.sql import SparkSession
except ImportError:  # pragma: no cover - 팀 기본 환경에는 pyspark가 없다
    SparkSession = None

S = ("sid long, uid long, alert_enabled boolean, dur_ms long, good_ds long")
X = ("sid long, s_ms long, e_ms long")
E = ("sid long, seq int, s_ms long, e_ms long, has_alert int")


@unittest.skipIf(SparkSession is None, "pyspark 없음")
class DailyStatComputeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import j2_daily_stat
        cls.job = j2_daily_stat
        cls.spark = (SparkSession.builder.master("local[1]").appName("j2-test")
                     .config("spark.ui.enabled", "false").config("spark.sql.shuffle.partitions", "2")
                     .getOrCreate())
        cls.spark.sparkContext.setLogLevel("ERROR")

    @classmethod
    def tearDownClass(cls):
        cls.spark.stop()

    def run_compute(self, sessions, excluded, events):
        df = self.job.compute(self.spark.createDataFrame(sessions, S), self.spark.createDataFrame(excluded, X),
                              self.spark.createDataFrame(events, E))
        return {r["uid"]: r.asDict() for r in df.collect()}

    def test_short_session_valid_time_and_counts(self):
        # 통합 테스트 11단계 D-39 세션과 같은 모양: 8.0초, PAUSE 2.0~4.5, MISSING 6.5~8.0, good 4.0
        out = self.run_compute([(1, 10, True, 8000, 40)], [(1, 2000, 4500), (1, 6500, 8000)], [])
        r = out[10]
        self.assertEqual((r["valid_ds"], r["good_ds"], r["session_count"], r["event_count"],
                          r["alerted_event_count"]), (40, 40, 1, 0, 0))
        self.assertIsNone(r["min_until_ds"])  # 5분 미만 세션은 표본 없음
        self.assertIsNone(r["max_until_ds"])

    def test_excluded_clipped_to_session_and_truncated_per_session(self):
        # 제외 구간이 세션 앞뒤로 삐져나와도 세션 안만 뺀다. 세션마다 0.1초 아래 버림 후 더함
        out = self.run_compute([(1, 10, True, 10_050, 0), (2, 10, True, 5_099, 0)],
                               [(1, -500, 1_000), (1, 9_500, 12_000), (2, 0, 0)], [])
        # 세션1: 10050 − (1000 + 550) = 8500 → 85 · 세션2: 5099 → 50 (5.099 → 5.0)
        self.assertEqual(out[10]["valid_ds"], 135)
        self.assertEqual(out[10]["session_count"], 2)

    def test_alerted_events_only_when_session_alert_enabled(self):
        out = self.run_compute(
            [(1, 10, True, 85_000, 150), (2, 20, False, 60_000, 100)], [],
            [(1, 1, 5_000, 78_000, 1), (2, 1, 1_000, 30_000, 1), (2, 2, 40_000, 50_000, 0)])
        self.assertEqual((out[10]["event_count"], out[10]["alerted_event_count"]), (1, 1))
        self.assertEqual((out[20]["event_count"], out[20]["alerted_event_count"]), (2, 0))

    def test_until_collapse_segments_with_exclusion_overlap(self):
        # 10분 세션: 붕괴 [120s, 200s], [400s, 450s]. 제외 구간 300~330s(30초).
        # 구간: 0→120 = 120s · 200→400 = 200 − 30 = 170s · 450→600 = 150s → 최소 120.0, 최대 170.0
        out = self.run_compute([(1, 10, True, 600_000, 3000)], [(1, 300_000, 330_000)],
                               [(1, 1, 120_000, 200_000, 1), (1, 2, 400_000, 450_000, 1)])
        self.assertEqual((out[10]["min_until_ds"], out[10]["max_until_ds"]), (1200, 1700))

    def test_until_collapse_no_event_and_event_until_session_end(self):
        # 붕괴 없는 5분 세션은 전체가 표본(유효 300s − 제외 0). 세션 끝까지 이어진 붕괴 뒤에는 표본 없음(길이 0)
        out = self.run_compute([(1, 10, True, 300_000, 0), (2, 20, True, 400_000, 0)], [],
                               [(2, 1, 100_050, 400_000, 1)])
        self.assertEqual((out[10]["min_until_ds"], out[10]["max_until_ds"]), (3000, 3000))
        self.assertEqual((out[20]["min_until_ds"], out[20]["max_until_ds"]), (1000, 1000))  # 100.05 → 100.0

    def test_min_max_across_sessions_of_one_user_and_short_sessions_ignored(self):
        out = self.run_compute([(1, 10, True, 360_000, 0), (2, 10, True, 600_000, 0), (3, 10, True, 200_000, 0)],
                               [], [(2, 1, 30_000, 60_000, 0), (3, 1, 1_000, 2_000, 0)])
        # 세션1: 360s · 세션2: 30s, 540s · 세션3(5분 미만)은 표본 아님 → 최소 30.0, 최대 540.0
        self.assertEqual((out[10]["min_until_ds"], out[10]["max_until_ds"]), (300, 5400))
        self.assertEqual(out[10]["event_count"], 2)

    def test_to_rows_formats_decimal_text(self):
        df = self.job.compute(self.spark.createDataFrame([(1, 7, True, 85_000, 150)], S),
                              self.spark.createDataFrame([], X), self.spark.createDataFrame([], E))
        rows = self.job.to_rows(df)
        self.assertEqual(rows[0]["valid_sec"], "85.0")
        self.assertEqual(rows[0]["good_sec"], "15.0")
        self.assertTrue(rows[0]["_good_le_valid"])


class DailyStatSqlTest(unittest.TestCase):
    def test_filter_uses_kst_day_and_only_ended_sessions(self):
        import datetime as dt
        sys.modules.pop("j2_daily_stat", None)
        import j2_daily_stat as job
        sql = job.sessions_sql(dt.date(2026, 10, 31), [12, 34])
        self.assertIn("m.started_at >= '2026-10-31 00:00:00' AND m.started_at < '2026-11-01 00:00:00'", sql)
        self.assertIn("m.ended_at IS NOT NULL", sql)
        self.assertIn("m.user_account_id IN (12,34)", sql)


class DailyStatWriteTest(unittest.TestCase):
    def test_write_deletes_day_then_inserts_rows(self):
        import datetime as dt
        import j2_daily_stat as job

        class FakeJdbc:
            def __init__(self):
                self.calls = []

            def execute(self, sql, params=()):
                self.calls.append((sql.split()[0], list(params)))
                return 3 if sql.startswith("DELETE") else 1

        fake = FakeJdbc()
        rows = [{"user_account_id": 7, "valid_sec": "81.0", "good_sec": "15.0", "session_count": 1, "event_count": 1,
                 "alerted_event_count": 1, "min_until_collapse_sec": None, "max_until_collapse_sec": None}]
        deleted, inserted = job.write(fake, dt.date(2026, 10, 31), [7, 8], rows, "2026-11-01 00:10:00.000")
        self.assertEqual((deleted, inserted), (3, 1))
        self.assertEqual(fake.calls[0], ("DELETE", ["2026-10-31", 7, 8]))
        self.assertEqual(fake.calls[1], ("INSERT", [7, "2026-10-31", "81.0", "15.0", 1, 1, 1, None, None,
                                                    "2026-11-01 00:10:00.000"]))


class DailyStatRecomputeTest(unittest.TestCase):
    """D-81: 최근 N일 다시 계산 — 날짜 목록, 저장된 행과 비교, 바뀐 날만 쓰기, 한 날짜 실패는 다른 날짜를 막지 않음."""

    ROW = {"user_account_id": 7, "valid_sec": "81.0", "good_sec": "15.0", "session_count": 1, "event_count": 1,
           "alerted_event_count": 1, "min_until_collapse_sec": None, "max_until_collapse_sec": None}

    def setUp(self):
        import j2_daily_stat
        self.job = j2_daily_stat

    def test_target_days_oldest_first_ending_at_end_date(self):
        import datetime as dt
        days = self.job.target_days(dt.date(2026, 11, 7), 3)
        self.assertEqual(days, [dt.date(2026, 11, 5), dt.date(2026, 11, 6), dt.date(2026, 11, 7)])
        self.assertEqual(self.job.target_days(dt.date(2026, 11, 7), 1), [dt.date(2026, 11, 7)])

    def test_parse_days_range(self):
        self.assertEqual(self.job.parse_days("7"), 7)
        for bad in ("0", "32", "-1"):
            with self.assertRaises(ValueError):
                self.job.parse_days(bad)

    def test_same_rows_ignores_key_order_and_detects_any_change(self):
        stored = [dict(reversed(list(self.ROW.items())))]
        self.assertTrue(self.job.same_rows([dict(self.ROW)], stored))
        self.assertFalse(self.job.same_rows([dict(self.ROW, good_sec="15.1")], stored))
        self.assertFalse(self.job.same_rows([], stored))                       # 세션이 지워진 날
        self.assertFalse(self.job.same_rows([dict(self.ROW)], []))             # 늦게 닫혀 처음 생긴 날
        self.assertTrue(self.job.same_rows([], []))

    def run_day(self, computed, stored, dry_run=False, good_le_valid=True):
        import datetime as dt
        from unittest import mock
        frame = mock.MagicMock()
        frame.cache.return_value = frame
        frame.count.return_value = len(computed)
        rows = [dict(r, _good_le_valid=good_le_valid) for r in computed]
        with mock.patch.object(self.job.bc, "read_query", return_value=frame), \
                mock.patch.object(self.job, "compute"), \
                mock.patch.object(self.job, "to_rows", return_value=rows), \
                mock.patch.object(self.job, "show_rows", return_value=stored), \
                mock.patch.object(self.job.bc, "Jdbc"), \
                mock.patch.object(self.job.bc, "log"), \
                mock.patch.object(self.job, "write", return_value=(len(stored), len(computed))) as write:
            result = self.job.run_day(None, None, dt.date(2026, 11, 5), [], dry_run)
        return result, write

    def test_unchanged_day_is_not_written(self):
        result, write = self.run_day([self.ROW], [dict(self.ROW)])
        self.assertFalse(result["changed"])
        write.assert_not_called()

    def test_changed_day_is_rewritten(self):
        result, write = self.run_day([self.ROW], [])
        self.assertTrue(result["changed"])
        write.assert_called_once()
        self.assertEqual(write.call_args.args[3], [self.ROW])

    def test_dry_run_reports_change_without_writing(self):
        result, write = self.run_day([self.ROW], [], dry_run=True)
        self.assertTrue(result["changed"])
        write.assert_not_called()

    def test_good_over_valid_day_is_error_not_written(self):
        result, write = self.run_day([self.ROW], [], good_le_valid=False)
        self.assertIn("error", result)
        write.assert_not_called()

    def test_main_continues_after_failed_day_and_exits_1(self):
        from unittest import mock
        def fake_run_day(spark, db, day, users, dry_run):
            if day.day == 6:
                return {"stat_date": day.isoformat(), "error": "x"}
            return {"stat_date": day.isoformat(), "changed": False, "rows": []}
        with mock.patch.object(self.job.bc, "DbConfig"), mock.patch.object(self.job.bc, "spark_session"), \
                mock.patch.object(self.job.bc, "log"), mock.patch("builtins.print"), \
                mock.patch.object(self.job, "run_day", side_effect=fake_run_day) as run_day:
            with self.assertRaises(SystemExit) as stop:
                self.job.main(["--date", "2026-11-07", "--days", "3"])
        self.assertEqual(stop.exception.code, 1)
        self.assertEqual([c.args[2].day for c in run_day.call_args_list], [5, 6, 7])


if __name__ == "__main__":
    unittest.main()
