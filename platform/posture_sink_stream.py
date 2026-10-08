"""
posture-sink 최소 버전 (Kafka -> Spark Structured Streaming -> HDFS Parquet).

계획서 "빅데이터 플랫폼 구성 > 처리·탐색 계층"에서 말하는 posture-sink의
핵심 동작만 재현한다: posture.summary 토픽을 지속적으로 구독하면서
5~10초 주기 마이크로배치로 정규화 특징값을 이벤트 시각(capturedAt)
기준 파티셔닝하여 HDFS에 Parquet로 적재한다.

이 스크립트가 하지 않는 것 (아직 범위 밖):
- Esper CEP(posture-cep)의 지속조건/재알림 판정 — 여기서는 원본
  이벤트를 그대로 적재만 한다.
- Redis 캐싱, 마트 집계, 학습셋 조립(Spark 배치) — 별도 후속 작업.
- 스키마 진화(버전업) 처리 — schemaVersion 필드는 그대로 통과시키되
  아직 분기 로직은 없다.

이벤트 스키마는 api-server의
`PostureSummaryEvent`(schemaVersion, sessionId, userId, capturedAt,
serverReceivedAt, featureVector, deviationScore, ruleStatus,
sampleRateHz)와 1:1로 맞춘 것이다 — 필드가 바뀌면 이 스키마도 함께
바꿔야 한다(계획서 4장 "API·데이터 라벨·통계 정의가 변경되면 관련
명세를 함께 수정" 원칙).
"""
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import (
    ArrayType,
    DoubleType,
    IntegerType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

HDFS_URI = "hdfs://hdfs-namenode:9000"
KAFKA_BOOTSTRAP = "kafka:19092"
TOPIC = "posture.summary"
OUTPUT_PATH = f"{HDFS_URI}/posture/features/stream"
CHECKPOINT_PATH = f"{HDFS_URI}/posture/checkpoints/posture-sink"
# (D-20) 날짜 파티션(eventDate)의 기준 시간대 — 프로젝트 시각 기준은 KST(2026-10-07 결정)
SESSION_TIMEZONE = "Asia/Seoul"

# api-server PostureSummaryEvent.java 와 1:1 대응
EVENT_SCHEMA = StructType(
    [
        StructField("schemaVersion", IntegerType()),
        StructField("sessionId", StringType()),
        StructField("userId", StringType()),
        StructField("capturedAt", TimestampType()),
        StructField("serverReceivedAt", TimestampType()),
        StructField("featureVector", ArrayType(DoubleType())),
        StructField("deviationScore", DoubleType()),
        StructField("ruleStatus", StringType()),
        StructField("sampleRateHz", DoubleType()),
    ]
)


def main() -> None:
    spark = (
        SparkSession.builder.appName("posture-sink")
        .config("spark.hadoop.fs.defaultFS", HDFS_URI)
        # (D-20) eventDate 파티션 날짜를 한국 날짜로 — 컨테이너 시간대에 기대지 않고 명시.
        # (변경 전에는 컨테이너가 UTC라 00:00~08:59 KST 데이터가 전날 파티션에 들어갔다)
        .config("spark.sql.session.timeZone", SESSION_TIMEZONE)
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("WARN")

    raw = (
        spark.readStream.format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_BOOTSTRAP)
        .option("subscribe", TOPIC)
        .option("startingOffsets", "earliest")
        .load()
    )

    parsed = (
        raw.selectExpr("CAST(value AS STRING) AS json_str")
        .select(F.from_json(F.col("json_str"), EVENT_SCHEMA).alias("event"))
        .select("event.*")
        .withColumn("eventDate", F.to_date(F.col("capturedAt")))
    )

    query = (
        parsed.writeStream.format("parquet")
        .option("path", OUTPUT_PATH)
        .option("checkpointLocation", CHECKPOINT_PATH)
        .partitionBy("eventDate")
        .outputMode("append")
        .trigger(processingTime="10 seconds")
        .start()
    )

    print(f"[posture-sink] 시작: {TOPIC} -> {OUTPUT_PATH} (10초 마이크로배치, earliest부터)")
    query.awaitTermination()


if __name__ == "__main__":
    main()
