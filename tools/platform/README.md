# 플랫폼 시험 도구

빅데이터 플랫폼([infra/compose/bigdata.yaml](../../infra/compose/bigdata.yaml))을 서버 PC에서 확인하는 도구다.
모두 저장소 루트 기준 경로로 실행한다. 참가자·부하 CSV와 결과 폴더는 Git에 넣지 않는다(`.gitignore`).

| 파일 | 용도 |
| --- | --- |
| `integration_test.sh` | 통합 테스트(컨테이너·Kafka·Redis·HDFS·Spark·서비스·v1 종단 판정, io-api가 있으면 입출구 REST, `REPORT_TEST_FIXTURES_ENABLED=true`면 판정 결과 저장 11단계, io-api가 있으면 실시간 WebSocket 왕복 12단계, web이 있으면 FE ↔ BE 연동 13단계 — 화면 nginx 경유(T-13)). `--quick`·`--no-e2e`·`--restart` |
| `replay_realtime_v1.py` | 계약 v1 경로 재생(시험용 입구) |
| `io_api_smoke.py` | 입출구 서버(io-api) REST 점검 — 합성 계정으로 가입·기준·세션·기록·삭제·탈퇴(통합 테스트 10단계, D-48). `--base`에 FE nginx(`http://127.0.0.1:8088/api`)도 된다(13단계) |
| `ws_realtime_smoke.py` | 실시간 WebSocket 왕복 점검 — 앱처럼 `/v2/realtime`에 합성 좌표 167구간을 보내 decision·alert·closed와 DB 기록(`--report` 처리 서비스)을 확인. 판정 경로 local·kafka 둘 다 같은 기대값(통합 테스트 12단계, 계획 0031 3단계). `--base`가 `…/api`면 그 경로로(13단계). 표준 라이브러리만 |
| `test_db_connection.py` | 외부 MySQL 접속 확인 — 확정 서비스 DB(`SERVICE_DB_SCHEMA`, `--env-file infra/compose/.env`) |
| `requirements.txt` | 위 도구의 Python 의존성 |

(D-38, 10/21) 옛 `posture.summary` 경로 도구(T-10 CSV 생성·재생 `generate_collapse_test_csv.py`·`replay_posture_pilot_csv.py`,
부하 측정 `generate_load_test_csv.py`·`rebase_csv_to_now.py`·`run_capacity_stage.sh`)는 옛 경로와 함께 지웠다. 부하 재측정(T-14)은 v1 경로 도구로 새로 만든다.
Spark↔HDFS Parquet 왕복 점검 코드는 `tests/hdfs_parquet_roundtrip.py`(통합 테스트 5단계, D-64)다.

```sh
pip install -r tools/platform/requirements.txt
tools/platform/integration_test.sh --quick
```
