"""Spark 배치 J2 — 일별 통계(daily_stat) 집계 (D-05, 아키텍처 v5.3 ⑰).

매일 00:10(KST, cron)에 전날 세션을 사용자별로 모아 daily_stat에 쓴다. 입출구 서버는 읽기만 한다(T1).
규칙은 database/README.md 「일별 통계」·「붕괴까지 걸린 시간」과 schema_V2_7.sql daily_stat 설명을 따른다.

- 대상: started_at의 KST 날짜가 집계 날짜인 세션 중 **끝난 세션**(ended_at 있음). 끝나지 않은 세션(측정 중이거나
  판정 상태를 잃고 닫히지 않은 행 — R2 삭제 뒤 생김)은 넣지 않는다. 날짜를 넘긴 세션은 시작 날짜에 넣는다.
- valid_sec: 세션마다 (세션 길이 − 세션과 겹친 제외 구간 합)을 0.1초 아래 버리고 더한다. 합은 다시 버리지 않는다.
- good_sec: 세션 good_sec(이미 버린 값)을 더한다.
- session_count·event_count(붕괴 이벤트 수)·alerted_event_count(alert_enabled 세션에서 알림 행이 있는 이벤트 수).
- min/max_until_collapse_sec: 실행 시간 5분(STAT_MIN_SESSION_SEC) 이상인 세션만. 구간 = 세션 시작 또는 직전 붕괴의
  ended_at → 다음 붕괴의 started_at, 마지막 구간은 → 세션 끝. 길이가 0인 구간은 표본이 아니다. 구간 길이에서 겹친
  제외 구간 시간을 빼고 표본마다 0.1초 아래 버린다. 표본이 없으면 둘 다 NULL.
- 쓰기: 한 트랜잭션에서 그 날짜(--user면 그 사용자들)의 행을 지우고 새로 넣는다 — 다시 돌려도 같은 결과(멱등).
  세션이 없는 사용자는 행을 만들지 않는다. 계산한 행이 저장된 행과 같으면 쓰지 않는다(computed_at 유지, 「변경 없음」).
- 다시 계산(D-81): --days N이면 끝 날짜(--date, 기본 어제)부터 N일 전까지 날짜마다 계산한다. J2가 지나간 뒤 닫힌 세션
  (저장 지연·나중에 닫힘)이나 지워진 세션(R3)을 그 날짜에 반영하려는 것 — cron은 --days 7. 7일보다 늦게 닫힌 세션은
  --date로 직접 다시 돌린다. 한 날짜가 실패해도 다른 날짜는 계속하고, 실패가 있으면 끝 코드 1.

실행(서버 PC 저장소 루트): tools/platform/batch.sh j2 [--date YYYY-MM-DD] [--days N] [--user 12,34] [--dry-run | --show]
"""

import argparse
import datetime as dt
import json

import batch_common as bc

JOB = "J2"
STAT_MIN_SESSION_MS = 300_000  # STAT_MIN_SESSION_SEC 5분
MAX_DAYS = 31                  # --days 상한(한 번에 다시 계산할 날짜 수)


# ---------------------------------------------------------------------------
# 읽기 — 시각은 SQL에서 세션 시작 기준 밀리초로 바꾼다 (시간대 변환 없음)

def _session_filter(day, users):
    start = f"{day.isoformat()} 00:00:00"
    end = f"{(day + dt.timedelta(days=1)).isoformat()} 00:00:00"
    where = f"m.started_at >= '{start}' AND m.started_at < '{end}' AND m.ended_at IS NOT NULL"
    if users:
        where += " AND m.user_account_id IN (" + ",".join(str(u) for u in users) + ")"
    return where


def sessions_sql(day, users):
    return ("SELECT m.monitor_session_id AS sid, m.user_account_id AS uid, m.alert_enabled AS alert_enabled,"
            " TIMESTAMPDIFF(MICROSECOND, m.started_at, m.ended_at) DIV 1000 AS dur_ms,"
            " CAST(ROUND(m.good_sec * 10) AS SIGNED) AS good_ds"
            " FROM monitor_session m WHERE " + _session_filter(day, users))


def excluded_sql(day, users):
    return ("SELECT e.monitor_session_id AS sid,"
            " TIMESTAMPDIFF(MICROSECOND, m.started_at, e.started_at) DIV 1000 AS s_ms,"
            " TIMESTAMPDIFF(MICROSECOND, m.started_at, COALESCE(e.ended_at, m.ended_at)) DIV 1000 AS e_ms"
            " FROM excluded_interval e JOIN monitor_session m ON m.monitor_session_id = e.monitor_session_id"
            " WHERE " + _session_filter(day, users))


def events_sql(day, users):
    return ("SELECT c.monitor_session_id AS sid, c.event_seq AS seq,"
            " TIMESTAMPDIFF(MICROSECOND, m.started_at, c.started_at) DIV 1000 AS s_ms,"
            " TIMESTAMPDIFF(MICROSECOND, m.started_at, COALESCE(c.ended_at, m.ended_at)) DIV 1000 AS e_ms,"
            " EXISTS (SELECT 1 FROM correction_alert a WHERE a.monitor_session_id = c.monitor_session_id"
            "         AND a.event_seq = c.event_seq) AS has_alert"
            " FROM collapse_event c JOIN monitor_session m ON m.monitor_session_id = c.monitor_session_id"
            " WHERE " + _session_filter(day, users))


# ---------------------------------------------------------------------------
# 계산 — 입력 DataFrame 3개(sessions·excluded·events, 위 SQL과 같은 열) → 사용자별 1행

def compute(sessions, excluded, events):
    """sessions(sid, uid, alert_enabled, dur_ms, good_ds), excluded(sid, s_ms, e_ms),
    events(sid, seq, s_ms, e_ms, has_alert) → DataFrame(uid, valid_ds, good_ds, session_count, event_count,
    alerted_event_count, min_until_ds, max_until_ds). 시간 값은 0.1초 단위 정수(ds)."""
    from pyspark.sql import functions as F
    from pyspark.sql.window import Window

    dur = sessions.select("sid", "dur_ms")

    # 제외 구간을 세션 안으로 자른다(끝나지 않은 구간은 세션 끝까지 — SQL에서 COALESCE)
    ex = (excluded.join(dur, "sid")
          .select("sid",
                  F.greatest(F.col("s_ms"), F.lit(0)).alias("s_ms"),
                  F.least(F.col("e_ms"), F.col("dur_ms")).alias("e_ms"))
          .where(F.col("e_ms") > F.col("s_ms")))

    excluded_ms = ex.groupBy("sid").agg(F.sum(F.col("e_ms") - F.col("s_ms")).alias("ex_ms"))
    per_session = (sessions.join(excluded_ms, "sid", "left")
                   .withColumn("ex_ms", F.coalesce("ex_ms", F.lit(0)))
                   .withColumn("valid_ds", F.floor(F.greatest(F.col("dur_ms") - F.col("ex_ms"), F.lit(0)) / 100)))

    ev = events.join(sessions.select("sid", "alert_enabled"), "sid")
    event_counts = ev.groupBy("sid").agg(
        F.count(F.lit(1)).alias("event_count"),
        F.sum(F.when(F.col("alert_enabled").cast("boolean") & F.col("has_alert").cast("boolean"), 1)
              .otherwise(0)).alias("alerted_event_count"))

    # 붕괴까지 걸린 시간 — 5분 이상 세션의 구간들
    long_sessions = sessions.where(F.col("dur_ms") >= STAT_MIN_SESSION_MS).select("sid", "uid", "dur_ms")
    order = Window.partitionBy("sid").orderBy("s_ms", "seq")
    ev_long = events.join(long_sessions.select("sid"), "sid")
    before_each = (ev_long
                   .withColumn("seg_s", F.coalesce(F.lag("e_ms").over(order), F.lit(0)))
                   .select("sid", "seg_s", F.col("s_ms").alias("seg_e")))
    last_end = ev_long.groupBy("sid").agg(F.max("e_ms").alias("last_e"))
    tail = (long_sessions.join(last_end, "sid", "left")
            .select("sid", F.coalesce("last_e", F.lit(0)).alias("seg_s"), F.col("dur_ms").alias("seg_e")))
    segments = (before_each.unionByName(tail)
                .where(F.col("seg_e") > F.col("seg_s"))
                .withColumn("seg_id", F.monotonically_increasing_id()))
    overlap = (segments.join(ex, "sid")
               .select("seg_id",
                       F.greatest(F.least("seg_e", "e_ms") - F.greatest("seg_s", "s_ms"), F.lit(0)).alias("ov"))
               .groupBy("seg_id").agg(F.sum("ov").alias("ov_ms")))
    samples = (segments.join(overlap, "seg_id", "left")
               .withColumn("ov_ms", F.coalesce("ov_ms", F.lit(0)))
               .withColumn("sample_ds",
                           F.floor(F.greatest(F.col("seg_e") - F.col("seg_s") - F.col("ov_ms"), F.lit(0)) / 100))
               .join(long_sessions.select("sid", "uid"), "sid")
               .groupBy("uid").agg(F.min("sample_ds").alias("min_until_ds"),
                                   F.max("sample_ds").alias("max_until_ds")))

    totals = (per_session.join(event_counts, "sid", "left")
              .groupBy("uid").agg(
                  F.sum("valid_ds").alias("valid_ds"),
                  F.sum(F.coalesce("good_ds", F.lit(0))).alias("good_ds"),
                  F.count(F.lit(1)).alias("session_count"),
                  F.sum(F.coalesce("event_count", F.lit(0))).alias("event_count"),
                  F.sum(F.coalesce("alerted_event_count", F.lit(0))).alias("alerted_event_count")))
    return totals.join(samples, "uid", "left")


def to_rows(result):
    """DataFrame → dict 목록(사용자 순, 0.1초 단위 문자열). `_good_le_valid`는 DB CHECK(good ≤ valid) 사전 검사용."""
    def sec(ds):
        return None if ds is None else f"{int(ds) // 10}.{int(ds) % 10}"
    rows = []
    for r in sorted(result.collect(), key=lambda row: row["uid"]):
        rows.append({
            "user_account_id": int(r["uid"]),
            "valid_sec": sec(r["valid_ds"]), "good_sec": sec(r["good_ds"]),
            "session_count": int(r["session_count"]), "event_count": int(r["event_count"]),
            "alerted_event_count": int(r["alerted_event_count"]),
            "min_until_collapse_sec": sec(r["min_until_ds"]), "max_until_collapse_sec": sec(r["max_until_ds"]),
            "_good_le_valid": int(r["good_ds"] or 0) <= int(r["valid_ds"] or 0),
        })
    return rows


def stored_sql(day, users):
    sql = ("SELECT user_account_id, valid_sec, good_sec, session_count, event_count, alerted_event_count,"
           " min_until_collapse_sec, max_until_collapse_sec FROM daily_stat"
           f" WHERE stat_date = '{day.isoformat()}'")
    if users:
        sql += " AND user_account_id IN (" + ",".join(str(u) for u in users) + ")"
    return sql


def show_rows(df):
    def text(value):
        return None if value is None else f"{value:.1f}"
    return [{"user_account_id": int(r["user_account_id"]), "valid_sec": text(r["valid_sec"]),
             "good_sec": text(r["good_sec"]), "session_count": int(r["session_count"]),
             "event_count": int(r["event_count"]), "alerted_event_count": int(r["alerted_event_count"]),
             "min_until_collapse_sec": text(r["min_until_collapse_sec"]),
             "max_until_collapse_sec": text(r["max_until_collapse_sec"])}
            for r in sorted(df.collect(), key=lambda row: row["user_account_id"])]


def target_days(end, days):
    """끝 날짜부터 days일 전까지, 오래된 날짜부터."""
    return [end - dt.timedelta(days=i) for i in range(days - 1, -1, -1)]


def same_rows(computed, stored):
    """계산한 행(to_rows, `_good_le_valid` 뺀 뒤)과 저장된 행(show_rows)이 같은가 — 둘 다 사용자 순, 0.1초 문자열."""
    return [dict(r) for r in computed] == [dict(r) for r in stored]


def parse_days(text):
    value = int(text)
    if not 1 <= value <= MAX_DAYS:
        raise ValueError(f"--days는 1~{MAX_DAYS}")
    return value


# ---------------------------------------------------------------------------
# 쓰기

INSERT_SQL = ("INSERT INTO daily_stat (user_account_id, stat_date, valid_sec, good_sec, session_count, event_count,"
              " alerted_event_count, min_until_collapse_sec, max_until_collapse_sec, computed_at)"
              " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")


def write(jdbc, day, users, rows, computed_at):
    """그 날짜(·사용자)의 행을 지우고 다시 넣는다. 지운 행 수, 넣은 행 수."""
    sql = "DELETE FROM daily_stat WHERE stat_date = ?"
    params = [day.isoformat()]
    if users:
        sql += " AND user_account_id IN (" + ",".join("?" for _ in users) + ")"
        params += users
    deleted = jdbc.execute(sql, params)
    for r in rows:
        jdbc.execute(INSERT_SQL, (r["user_account_id"], day.isoformat(), r["valid_sec"], r["good_sec"],
                                  r["session_count"], r["event_count"], r["alerted_event_count"],
                                  r["min_until_collapse_sec"], r["max_until_collapse_sec"], computed_at))
    return deleted, len(rows)


def run_day(spark, db, day, users, dry_run):
    """한 날짜: 계산 → 저장된 행과 비교 → 다르면 지우고 넣기. 결과 dict(실패면 error)."""
    sessions = bc.read_query(spark, db, sessions_sql(day, users)).cache()
    try:
        excluded = bc.read_query(spark, db, excluded_sql(day, users))
        events = bc.read_query(spark, db, events_sql(day, users))
        rows = to_rows(compute(sessions, excluded, events))
        session_count = sessions.count()
    finally:
        sessions.unpersist()
    bad = [r["user_account_id"] for r in rows if not r.pop("_good_le_valid")]
    if bad:
        bc.log(JOB, f"FAIL {day} good_sec > valid_sec 인 사용자 {bad} — 세션 good_sec·제외 구간 확인, 쓰지 않음")
        return {"stat_date": day.isoformat(), "error": f"good_sec > valid_sec {bad}"}
    stored = show_rows(bc.read_query(spark, db, stored_sql(day, users)))
    changed = not same_rows(rows, stored)
    bc.log(JOB, f"{day} 세션 {session_count}개 · 사용자 {len(rows)}명 계산 · 저장된 행 {len(stored)}개"
                f" · {'바뀜' if changed else '변경 없음'}")
    result = {"stat_date": day.isoformat(), "changed": changed, "rows": rows}
    if dry_run or not changed:
        if not changed and not dry_run:
            bc.log(JOB, f"OK {day} 변경 없음 — 쓰지 않음")
        return result
    with bc.Jdbc(spark, db) as jdbc:
        deleted, inserted = write(jdbc, day, users, rows, bc.now_kst_text())
    bc.log(JOB, f"OK {day} daily_stat 지움 {deleted} · 넣음 {inserted}")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--date", type=bc.parse_date, default=None, help="집계 날짜 KST (기본: 어제). --days와 함께면 끝 날짜")
    parser.add_argument("--days", type=parse_days, default=1,
                        help=f"끝 날짜부터 N일 전까지 다시 계산 (기본 1, 최대 {MAX_DAYS}, cron은 7)")
    parser.add_argument("--user", type=bc.parse_users, default=[], help="이 사용자만 (쉼표로 여러 명, 시험용)")
    parser.add_argument("--dry-run", action="store_true", help="계산만 하고 쓰지 않음 (결과를 JSON으로 출력)")
    parser.add_argument("--show", action="store_true", help="계산하지 않고 저장된 daily_stat 행만 JSON으로 출력(확인용)")
    args = parser.parse_args(argv)
    days = target_days(args.date or bc.yesterday_kst(), args.days)

    db = bc.DbConfig()
    spark = bc.spark_session(f"posegood-j2-daily-stat-{days[-1]}")
    failed = []
    try:
        for day in days:
            if args.show:
                stored = show_rows(bc.read_query(spark, db, stored_sql(day, args.user)))
                print(json.dumps({"stat_date": day.isoformat(), "stored": stored}, ensure_ascii=False), flush=True)
                bc.log(JOB, f"SHOW {day} daily_stat {len(stored)}행")
                continue
            result = run_day(spark, db, day, args.user, args.dry_run)
            if "error" in result:
                failed.append(day.isoformat())
            print(json.dumps(result, ensure_ascii=False), flush=True)
        if args.dry_run:
            bc.log(JOB, "DRY-RUN — 쓰지 않음")
        if len(days) > 1:
            bc.log(JOB, f"{days[0]} ~ {days[-1]} {len(days)}일 끝 · 실패 {len(failed)}일")
    finally:
        spark.stop()
    if failed:
        bc.fail(JOB, f"실패한 날짜 {failed} — 다른 날짜는 끝남")


if __name__ == "__main__":
    main()
