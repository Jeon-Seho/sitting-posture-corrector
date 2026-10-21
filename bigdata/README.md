# 빅데이터 배치 (Spark)

서버 PC cron이 `docker exec spark spark-submit`으로 실행하는 Spark 배치를 둔다(아키텍처 v5.2).
컨테이너 구성은 [infra/compose/bigdata.yaml](../infra/compose/bigdata.yaml)이다.

| 폴더 | 내용 |
| --- | --- |
| `jobs/` | (예정) J1 적재 매시간, J2 일별 통계 매일 00:00, J3 탈퇴 삭제 매일 04:00 |
| `cron/` | (예정) crontab과 겹쳐 실행 막기 스크립트 |
| `tools/` | 점검 도구 — `hdfs_parquet_roundtrip.py`(Spark↔HDFS Parquet 왕복, 통합 테스트 5단계) |
| `legacy/` | 기존 경로 posture-sink(`posture.summary` → HDFS 상주 스트리밍)와 확인 스크립트. J1이 대체하면 지운다 |
