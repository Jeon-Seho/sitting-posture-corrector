"""
Spark ↔ HDFS Parquet 왕복 점검 (통합 테스트 5단계, spark 컨테이너 안에서 spark-submit으로 실행).

pytest가 모으지 않는다(파일 이름이 test_로 시작하지 않음, pyspark는 spark 컨테이너에만 있음).
tools/platform/integration_test.sh가 spark 컨테이너에 복사해 실행한다:
    docker cp tests/hdfs_parquet_roundtrip.py spark:/opt/spark/it_roundtrip.py
    docker exec spark /opt/spark/bin/spark-submit --master 'local[2]' /opt/spark/it_roundtrip.py

목적: Spark가 HDFS에 Parquet을 이벤트 날짜로 나눠 쓰고 다시 읽을 수 있는지 — "컨테이너가 떠 있다"가 아니라
"Spark ↔ HDFS 배관이 뚫려 있다"를 확인한다. 배치 잡 J1~J3(bigdata/, D-33·D-05·D-49)의 전제다.
(D-64, 10/21) bigdata/tools/에서 옮겼다. 옛 posture-sink(bigdata/legacy/)는 D-38에서 지웠다.
"""
import datetime

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

HDFS_URI = "hdfs://hdfs-namenode:9000"
OUTPUT_PATH = f"{HDFS_URI}/posture/features/roundtrip-test"


def main() -> None:
    spark = (
        SparkSession.builder.appName("posture-hdfs-roundtrip-test")
        .config("spark.hadoop.fs.defaultFS", HDFS_URI)
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("WARN")

    now = datetime.datetime.utcnow()
    event_date = now.strftime("%Y-%m-%d")

    # 예시 레코드 3건(세션·사용자·시각·점수·상태)
    rows = [
        ("session-hdfs-test", "user-1", now.isoformat(), 0.12, "NORMAL"),
        ("session-hdfs-test", "user-1", now.isoformat(), 0.35, "WARNING"),
        ("session-hdfs-test", "user-1", now.isoformat(), 0.61, "BAD"),
    ]
    columns = ["sessionId", "userId", "capturedAt", "deviationScore", "status"]

    df = spark.createDataFrame(rows, columns).withColumn("eventDate", F.lit(event_date))

    print(f"[STEP 1] {OUTPUT_PATH} 에 Parquet로 쓰기 시작 ({df.count()}건)")
    df.write.mode("overwrite").partitionBy("eventDate").parquet(OUTPUT_PATH)
    print("[WRITE OK] HDFS에 Parquet 파일 쓰기 완료")

    print(f"[STEP 2] {OUTPUT_PATH} 에서 다시 읽기")
    read_df = spark.read.parquet(OUTPUT_PATH)
    count = read_df.count()
    print(f"[READ OK] {count}건 읽음 (쓴 건수와 같아야 정상)")
    read_df.orderBy("deviationScore").show(truncate=False)

    if count != len(rows):
        raise SystemExit(
            f"[FAIL] 쓴 건수({len(rows)})와 읽은 건수({count})가 다르다 — HDFS 적재에 문제가 있다"
        )

    print("[RESULT] HDFS <-> Spark 왕복 테스트 성공")
    spark.stop()


if __name__ == "__main__":
    main()
