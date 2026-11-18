"""Spark 배치 J1 — 판정 과정·좌표 적재: Kafka v1 토픽 → HDFS 임시 폴더 → 끝난 세션을 사용자별 폴더로 + feature_archive (D-33·D-92).

두 단계로 돈다(매시간 cron, tools/platform/batch.sh j1):
1. 받기: posture.features.v1·posture.inference.v1·posture.episodes.v1을 Structured Streaming trigger(availableNow)로
   지난번 위치부터 지금까지 읽어 임시 폴더 /data/staging/realtime-v1/topic=…/date=…(Parquet, 원문 JSON 그대로)에 붙인다.
   읽은 위치는 /data/checkpoints/j1-realtime-v1에 남아 다음 실행이 이어 읽는다(처음에는 토픽에 남은 가장 앞부터).
   (D-92) 좌표 구간 토픽 posture.keypoints.v1은 따로 읽는다 — 쿼리·체크포인트(/data/checkpoints/j1-keypoints-v1)와
   임시 폴더(/data/staging/keypoints-v1/topic=…/date=…)를 모두 따로 둔다. 기존 체크포인트의 구독 목록을 바꾸면 Spark가 이어
   읽기를 보장하지 않고, 두 쿼리가 같은 임시 폴더(같은 _spark_metadata)에 쓰면 뒤 쿼리의 배치가 「이미 쓴 배치」로 건너뛰어져
   아무것도 쓰지 않은 채 읽은 위치만 넘어가기 때문이다(11/13 서버에서 확인).
   (D-93) 같은 이유로 체크포인트만 지우면(다시 처음부터 읽게 하려고) 남은 _spark_metadata의 배치 번호 때문에 새 쿼리의
   앞 배치들이 건너뛰어진다. 그래서 받기 전에 체크포인트가 없는데 그 임시 폴더에 _spark_metadata가 있으면 메타데이터를 지운다
   (정리 단계는 하위 폴더를 직접 읽어 메타데이터를 쓰지 않는다 — 이미 받아 둔 Parquet 파일은 그대로).
2. 정리: 서비스 DB에서 끝난 지 settle(기본 10분) 지났고 아직 feature_archive가 없는 세션(계정 ACTIVE)을 골라,
   임시 폴더에서 그 세션 메시지를 모아 중복을 빼고 세션 폴더
   /data/users/{user_account_id}/{세션 시작일(KST)}/{client_session_uuid}/에 파일 3개(토픽마다 JSON Lines)로 쓴 뒤
   feature_archive 1행(file_uri·첫/마지막 구간 시각·적재 시각)을 넣는다. 세션 하나 = 폴더 하나 = 1행(DB V2.7).
   (D-92) 좌표 구간이 있는 세션(kafka 모드 + ws 스위치 켬)은 keypoints.jsonl도 쓴다(없으면 파일을 만들지 않음).
   - 중복: features·observation·keypoints는 body.sequence, decision은 event.event_id, 그 밖은 message_id로 하나만(가장 앞 offset).
   - 임시 폴더에 메시지가 없는 세션(지금 앱 측정은 Kafka를 거치지 않음 — D-57 전)은 건너뛴다.
   - 파일을 먼저 쓰고(덮어쓰기) 행을 넣는다 — 중간에 멈추면 다음 실행이 다시 쓴다.
3. 임시 폴더 정리: date 폴더가 보존 일수(기본 7일)보다 오래되면 지운다.

features.v1 본문은 특징 변화량이고(계약 kafka-spec 3.1) 좌표는 keypoints.v1에만 있다(관절 9개 [x, y, visibility],
계약 contracts/realtime/kafka-keypoints.v1.schema.json). 이메일은 어디에도 없다. 로그·출력에는 개수만 남긴다(좌표 금지).
실행: tools/platform/batch.sh j1 [--session UUID] [--settle-sec N] [--dry-run] [--skip-ingest]
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import batch_common as bc  # noqa: E402

JOB = "J1"
TOPICS = {"posture.features.v1": "features.jsonl", "posture.inference.v1": "inference.jsonl",
          "posture.episodes.v1": "episodes.jsonl"}
# (D-92) 좌표 구간 — 세션 폴더에 있을 때만 쓰는 파일. 받기는 별도 쿼리(체크포인트 따로)
KEYPOINTS = {"posture.keypoints.v1": "keypoints.jsonl"}
ALL_TOPICS = {**TOPICS, **KEYPOINTS}
STAGING = "/data/staging/realtime-v1"
KEYPOINTS_STAGING = "/data/staging/keypoints-v1"   # (D-92) 쿼리마다 임시 폴더를 따로(같은 폴더면 파일 싱크가 배치를 건너뜀)
CHECKPOINT = "/data/checkpoints/j1-realtime-v1"
KEYPOINTS_CHECKPOINT = "/data/checkpoints/j1-keypoints-v1"
SETTLE_SEC = 600
KEEP_DAYS = 7
UUID = re.compile(r"^[0-9a-fA-F-]{36}$")


def kafka_bootstrap(env=None):
    env = os.environ if env is None else env
    return env.get("J1_KAFKA_BOOTSTRAP") or env.get("KAFKA_BOOTSTRAP_SERVERS") or "kafka:19092"


# ---------------------------------------------------------------------------
# 1. 받기 (Kafka → 임시 폴더)

def staging_columns(df):
    """Kafka 행(key·value 바이트, topic, partition, offset, timestamp) → 임시 폴더 열."""
    from pyspark.sql import functions as F
    value = F.col("value").cast("string")
    return df.select(
        F.col("topic"), F.col("partition").cast("int").alias("partition"), F.col("offset").cast("long").alias("offset"),
        F.get_json_object(value, "$.session_id").alias("session_id"),
        F.get_json_object(value, "$.kind").alias("kind"),
        F.get_json_object(value, "$.message_id").alias("message_id"),
        value.alias("value"),
        F.date_format(F.col("timestamp"), "yyyy-MM-dd").alias("date"))


def staging_root(topic):
    """토픽의 임시 폴더 맨 위(쿼리마다 따로)."""
    return KEYPOINTS_STAGING if topic in KEYPOINTS else STAGING


def reset_orphan_sink_log(hdfs, staging, checkpoint):
    """(D-93) 체크포인트가 없는데 임시 폴더에 파일 싱크 메타데이터가 남아 있으면 지운다. 지웠으면 True.

    체크포인트를 지우면 새 쿼리는 배치 0부터 세는데, 남은 _spark_metadata에 더 큰 배치 번호가 있으면 Spark 파일 싱크가
    그 번호까지를 「이미 쓴 배치」로 건너뛰어 아무것도 쓰지 않은 채 읽은 위치만 넘어간다(11/13 서버, 오류 없이 유실).
    """
    metadata = staging + "/_spark_metadata"
    if hdfs.exists(checkpoint) or not hdfs.exists(metadata):
        return False
    hdfs.delete(metadata)
    bc.log(JOB, f"체크포인트 {checkpoint} 없음 — 남은 {metadata} 지움(처음부터 다시 받기)")
    return True


def ingest_topics(spark, hdfs, topics, staging, checkpoint):
    """토픽 묶음 하나를 지난번 위치부터 지금까지 그 묶음의 임시 폴더로. 받은 건수."""
    reset_orphan_sink_log(hdfs, staging, checkpoint)
    hdfs_uri = hdfs.uri
    raw = (spark.readStream.format("kafka")
           .option("kafka.bootstrap.servers", kafka_bootstrap())
           .option("subscribe", ",".join(topics))
           .option("startingOffsets", "earliest")
           .option("failOnDataLoss", "false")   # 보존 기간이 지나 지워진 위치는 건너뛴다
           .load())
    return stage_stream(raw, hdfs_uri, staging, checkpoint)


def stage_stream(raw, hdfs_uri, staging, checkpoint):
    """스트림(Kafka 행 형식)을 지금 있는 것까지 임시 폴더에 붙인다. 받은 건수."""
    query = (staging_columns(raw).writeStream.format("parquet")
             .option("path", hdfs_uri + staging).option("checkpointLocation", hdfs_uri + checkpoint)
             .partitionBy("topic", "date").trigger(availableNow=True).start())
    query.awaitTermination()
    return sum(int(p.get("numInputRows", 0)) for p in query.recentProgress)


def ingest(spark, hdfs):
    """판정 과정 3개 토픽 + (D-92) 좌표 토픽. (전체, 좌표) 받은 건수."""
    rows = ingest_topics(spark, hdfs, TOPICS, STAGING, CHECKPOINT)
    keypoints = ingest_topics(spark, hdfs, KEYPOINTS, KEYPOINTS_STAGING, KEYPOINTS_CHECKPOINT)
    return rows + keypoints, keypoints


# ---------------------------------------------------------------------------
# 2. 정리 (임시 폴더 → 세션 폴더 + feature_archive)

def candidates_sql(settle_cutoff, since, sessions):
    sql = ("SELECT m.monitor_session_id, m.client_session_uuid, m.user_account_id,"
           " DATE_FORMAT(m.started_at, '%Y-%m-%d %H:%i:%s.%f') AS started_at"
           " FROM monitor_session m JOIN user_account u ON u.user_account_id = m.user_account_id"
           " WHERE m.ended_at IS NOT NULL AND m.ended_at <= ? AND m.started_at >= ? AND u.account_status = 'ACTIVE'"
           " AND NOT EXISTS (SELECT 1 FROM feature_archive fa WHERE fa.monitor_session_id = m.monitor_session_id)")
    if sessions:
        sql += " AND m.client_session_uuid IN (" + ",".join("?" for _ in sessions) + ")"
    return sql + " ORDER BY m.ended_at"


def staging_paths(hdfs, today, keep_days):
    """보존 기간 안의 date 폴더만(오래된 것은 3단계가 지움). 없는 폴더는 뺀다."""
    out = []
    for topic in ALL_TOPICS:
        for back in range(keep_days + 1):
            day = (today - dt.timedelta(days=back)).isoformat()
            path = f"{staging_root(topic)}/topic={topic}/date={day}"
            if hdfs.exists(path):
                out.append(path)
    return out


def read_staging(spark, hdfs, paths):
    # 하위 폴더를 직접 읽는다 — 임시 폴더 맨 위의 _spark_metadata(지운 파일 목록)를 거치지 않게. topic·date는 basePath로.
    # 임시 폴더가 쿼리마다 따로라(D-92) 맨 위 폴더별로 읽어 합친다
    frames = []
    for root in (STAGING, KEYPOINTS_STAGING):
        group = [hdfs.uri + p for p in paths if p.startswith(root + "/")]
        if group:
            frames.append(spark.read.option("basePath", hdfs.uri + root).parquet(*group))
    out = frames[0]
    for frame in frames[1:]:
        out = out.unionByName(frame)
    return out


def dedupe(df):
    """세션·토픽 안에서 같은 메시지를 하나만 남긴다(가장 앞 offset)."""
    from pyspark.sql import Window
    from pyspark.sql import functions as F
    seq = F.get_json_object("value", "$.body.sequence")
    event_id = F.get_json_object("value", "$.body.event.event_id")
    key = (F.when(F.col("kind").isin("features", "observation", "keypoints") & seq.isNotNull(),
                  F.concat(F.lit("s:"), seq))
           .when((F.col("kind") == "decision") & event_id.isNotNull(), F.concat(F.lit("e:"), event_id))
           .when(F.col("kind").isin("session_started", "session_ended"), F.col("kind"))
           .otherwise(F.concat(F.lit("m:"), F.col("message_id"))))
    w = Window.partitionBy("session_id", "topic", "kind", "_key").orderBy("partition", "offset")
    return (df.withColumn("_key", key).withColumn("_n", F.row_number().over(w))
            .where("_n = 1").drop("_key", "_n"))


def collect_session(df, session_id):
    """토픽별 원문 줄 목록(offset 순)과 구간 범위(ms). 범위는 features 구간 → 없으면 observation."""
    rows = (df.where(df.session_id == session_id).select("topic", "partition", "offset", "kind", "value")
            .orderBy("topic", "partition", "offset").collect())
    lines = {t: [] for t in ALL_TOPICS}
    starts, ends, obs_starts, obs_ends = [], [], [], []
    for r in rows:
        lines[r["topic"]].append(r["value"])
        if r["kind"] in ("features", "observation"):
            body = json.loads(r["value"]).get("body") or {}
            if isinstance(body.get("start_ms"), int) and isinstance(body.get("end_ms"), int):
                (starts if r["kind"] == "features" else obs_starts).append(body["start_ms"])
                (ends if r["kind"] == "features" else obs_ends).append(body["end_ms"])
    if not starts:
        starts, ends = obs_starts, obs_ends
    rng = (min(starts), max(ends)) if starts else None
    return lines, rng


def kst_plus_ms(started_at, ms):
    base = dt.datetime.strptime(started_at[:23], "%Y-%m-%d %H:%M:%S.%f")
    return (base + dt.timedelta(milliseconds=ms)).strftime("%Y-%m-%d %H:%M:%S.%f")[:23]


def session_folder(uid, started_at, uuid):
    return f"{bc.user_folder(uid)}/{started_at[:10]}/{uuid}/"


INSERT_ARCHIVE = ("INSERT INTO feature_archive (monitor_session_id, file_uri, range_start_at, range_end_at, archived_at)"
                  " VALUES (?, ?, ?, ?, ?)")


def file_lines(lines):
    """세션 폴더에 쓸 파일 → 줄 목록. 판정 과정 3개는 늘 쓰고, 좌표(D-92)는 있을 때만."""
    out = {name: lines[topic] for topic, name in TOPICS.items()}
    out.update({name: lines[topic] for topic, name in KEYPOINTS.items() if lines[topic]})
    return out


def archive_session(jdbc, hdfs, cand, lines, rng, now_text):
    """파일 3개(좌표가 있으면 4개) 쓰고 행 1개. 쓴 줄 수."""
    folder = session_folder(cand["user_account_id"], cand["started_at"], cand["client_session_uuid"])
    counts = {}
    for name, rows in file_lines(lines).items():
        hdfs.write_text(folder + name, "".join(line + "\n" for line in rows))
        counts[name] = len(rows)
    start, end = rng
    jdbc.execute(INSERT_ARCHIVE, (int(cand["monitor_session_id"]), folder, kst_plus_ms(cand["started_at"], start),
                                  kst_plus_ms(cand["started_at"], end), now_text))
    jdbc.commit()
    return folder, counts


def organize(spark, jdbc, hdfs, args, now):
    settle_cutoff = (now - dt.timedelta(seconds=args.settle_sec)).strftime("%Y-%m-%d %H:%M:%S.%f")[:23]
    since = (now - dt.timedelta(days=args.keep_days)).strftime("%Y-%m-%d 00:00:00.000")
    cands = jdbc.query(candidates_sql(settle_cutoff, since, args.session), [settle_cutoff, since] + args.session)
    if not cands:
        return [], [], 0
    paths = staging_paths(hdfs, now.date(), args.keep_days)
    if not paths:
        return [], [c["client_session_uuid"] for c in cands], len(cands)
    uuids = [c["client_session_uuid"] for c in cands]
    from pyspark.sql import functions as F
    staged = dedupe(read_staging(spark, hdfs, paths).where(F.col("session_id").isin(uuids))).cache()
    present = {r["session_id"] for r in staged.select("session_id").distinct().collect()}
    done, missing = [], []
    for cand in cands:
        uuid = cand["client_session_uuid"]
        if uuid not in present:
            missing.append(uuid)
            continue
        lines, rng = collect_session(staged, uuid)
        if rng is None:
            missing.append(uuid)  # 구간 메시지 없음(시작·종료만) — 적재할 판정 과정이 없다
            continue
        if args.dry_run:
            done.append({"session": uuid, "user_account_id": int(cand["user_account_id"]),
                         "lines": {name: len(v) for name, v in file_lines(lines).items()}})
            continue
        folder, counts = archive_session(jdbc, hdfs, cand, lines, rng, bc.now_kst_text())
        bc.log(JOB, f"세션 적재 user {cand['user_account_id']} — {counts}")
        done.append({"session": uuid, "user_account_id": int(cand["user_account_id"]), "folder": folder, "lines": counts})
    staged.unpersist()
    return done, missing, len(cands)


# ---------------------------------------------------------------------------
# 3. 임시 폴더 정리

def old_staging_dirs(listing, today, keep_days):
    """listing: topic=…/date=… 폴더 경로들 → 보존 기간을 넘긴 것."""
    limit = (today - dt.timedelta(days=keep_days)).isoformat()
    out = []
    for path in listing:
        m = re.search(r"/date=(\d{4}-\d{2}-\d{2})$", path.rstrip("/"))
        if m and m.group(1) < limit:
            out.append(path.rstrip("/"))
    return out


def clean_staging(hdfs, today, keep_days):
    listing = []
    for topic in ALL_TOPICS:
        listing += hdfs.list_dirs(f"{staging_root(topic)}/topic={topic}")
    old = old_staging_dirs(listing, today, keep_days)
    for path in old:
        hdfs.delete(path)
    return old


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--session", default="", help="이 세션만 정리 (client_session_uuid, 쉼표로 여러 개, 시험용)")
    parser.add_argument("--settle-sec", type=int, default=SETTLE_SEC,
                        help=f"세션이 끝난 뒤 기다릴 초(기본 {SETTLE_SEC} — 늦게 오는 메시지 대비)")
    parser.add_argument("--keep-days", type=int, default=KEEP_DAYS, help=f"임시 폴더 보존 일수(기본 {KEEP_DAYS})")
    parser.add_argument("--dry-run", action="store_true", help="받기는 하고, 정리는 대상만 출력(쓰지 않음)")
    parser.add_argument("--skip-ingest", action="store_true", help="Kafka 받기를 건너뜀(정리만)")
    args = parser.parse_args(argv)
    args.session = [s.strip() for s in args.session.split(",") if s.strip()]
    if any(not UUID.match(s) for s in args.session):
        parser.error("--session은 UUID")
    if args.settle_sec < 0 or args.keep_days < 1:
        parser.error("--settle-sec ≥ 0, --keep-days ≥ 1")

    db = bc.DbConfig()
    spark = bc.spark_session("posegood-j1-hdfs-archive")
    try:
        hdfs = bc.Hdfs(spark)
        ingested, ingested_keypoints = None, None
        if not args.skip_ingest:
            ingested, ingested_keypoints = ingest(spark, hdfs)
            bc.log(JOB, f"받기 — Kafka 메시지 {ingested}건(그중 좌표 구간 {ingested_keypoints}건) → {STAGING}·{KEYPOINTS_STAGING}")
        now = dt.datetime.now(bc.KST).replace(tzinfo=None)
        with bc.Jdbc(spark, db) as jdbc:
            done, missing, total = organize(spark, jdbc, hdfs, args, now)
        removed = [] if args.dry_run else clean_staging(hdfs, now.date(), args.keep_days)
        bc.log(JOB, f"{'DRY-RUN ' if args.dry_run else 'OK '}대상 세션 {total}개 · 적재 {len(done)}개 · "
                    f"임시 폴더에 없음 {len(missing)}개 · 오래된 임시 폴더 {len(removed)}개 지움")
        print(json.dumps({"ingested": ingested, "ingested_keypoints": ingested_keypoints, "archived": done, "missing": missing, "removed_staging": removed},
                         ensure_ascii=False), flush=True)
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
