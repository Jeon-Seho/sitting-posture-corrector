# Spark 배치 J2 → J3 → J1 (일별 통계·탈퇴 삭제·HDFS 적재)

- 상태: in_progress (J2 서버 확인 완료 2026-11-01, 다음 J3)
- 담당: DevOps/BE (ghdrb1246)
- 시작일: 2026-11-01
- 관련: [database/README.md](../../../database/README.md) 「일별 통계」·「붕괴까지 걸린 시간」·「탈퇴 최종 삭제」·「삭제 배치 공통」, `database/schema/schema_V2_6.sql`(`daily_stat`·`deletion_request`·`feature_archive`), [아키텍처 v5.3 스택별 역할](../../design/architecture_v5.2_stack_roles.md) 적재·분석 층, [bigdata/README.md](../../../bigdata/README.md)

## 문제와 완료 기준

입출구 서버의 일별 통계 누적·탈퇴 삭제 스케줄러는 지워졌고 그 일을 Spark 배치가 맡기로 했지만(DB README 「역할 분담과 구현 상태」) 배치가 없다.
그래서 `daily_stat`이 채워지지 않고, 유예가 끝난 탈퇴 계정(통합 테스트 합성 계정 포함)이 지워지지 않으며, HDFS 적재가 없다.

완료 기준(잡마다):

- J2: 전날(KST) 끝난 세션을 사용자별로 `daily_stat`에 쓴다. 규칙은 DB README와 같다. 다시 돌려도 같은 결과. 통합 테스트 15단계 PASS.
- J3: 유예(30일)가 지난 `REQUESTED`·`FAILED` 요청을 `PROCESSING` → HDFS 사용자 폴더 → `feature_archive.deleted_at` → 행(하위부터) → `DONE`. 사용자 한 명 단위 트랜잭션, 실패는 `FAILED`·사유.
- J1: Kafka v1 토픽을 `availableNow`로 읽어 끝난 세션을 `/data/users/{user_account_id}/{시작일}/{client_session_uuid}/`에, `feature_archive` 세션 폴더 1행.
- cron(J2 00:10, J3 04:00, J1 매시간)과 실행기 `tools/platform/batch.sh`(잠금·로그·끝 코드).

## 범위와 제외

- 범위: `bigdata/jobs/`(PySpark), `infra/compose/bigdata.yaml` spark 서비스(.env·잡 마운트·드라이버 볼륨), `tools/platform/batch.sh`, 통합 테스트 단계, 시험.
- 제외: 입출구 서버 코드(`backend/api`), 통계 조회 API(T1, DB/BE), 완료 안내 발송 수단(남은 안건 — J3는 발송 자리만).
- J1의 실제 측정 데이터는 Kafka 전환(D-57) 뒤 들어온다. 그 전에는 시험 데이터로 확인한다.

## 작업 단계

- [x] DB 규칙·스키마 V2.6 확인
- [x] J2 계산·쓰기, `--date`·`--user`·`--dry-run`·`--show`, 실행기, compose 마운트
- [x] J2 계산 시험(로컬 Spark, 합성 데이터)
- [x] J2 서버 확인(통합 테스트 15단계)
- [ ] J2 cron 등록(서버 PC crontab, 00:10)
- [ ] J3
- [ ] J1
- [ ] 문서 동기화(DB README 「구현 상태」는 DB/BE에 알림)

## 결정과 진행 기록

- 2026-11-01: 한 브랜치에서 J2 → J3 → J1, 잡마다 커밋(사용자 지시).
- J2 대상은 **끝난 세션만**(`ended_at` 있음). 판정 상태를 잃고 닫히지 않은 행(R2 삭제로 생김)은 넣지 않는다 — 닫는 방법은 DB/BE 몫(계획 0062 남은 일).
- 길이 0인 「붕괴까지」 구간(붕괴가 세션 끝까지 이어진 뒤)은 표본으로 치지 않는다.
- J2 시각 00:10 — 자정 직전 세션 저장·자정 넘김 저장을 기다림(FE 제안서 BE-11 요청).
- 쓰기는 Spark JDBC(upsert 없음) 대신 드라이버 JVM의 JDBC 연결로 「그날 행 지우고 다시 넣기」 한 트랜잭션.
- 드라이버는 `--packages com.mysql:mysql-connector-j:8.4.0`(jar를 저장소에 넣지 않음).

## 검증 결과와 남은 한계

- 2026-11-01 작업 환경: `python -m pytest tests/test_batch_j2_daily_stat.py` — pyspark 4.0.1 로컬, 9개 통과(짧은 세션·제외 구간 자르기·세션마다 버림·알림 이벤트·붕괴까지 구간과 제외 겹침·붕괴 없는 세션·여러 세션 최소/최대·쓰기 SQL·날짜 필터).
- 2026-11-01 서버 PC: spark 컨테이너 다시 만듦(`spark-ivy` 볼륨 생성, `/opt/jobs` 마운트, DB 환경 값 4개 확인). `batch.sh j2 --date 2026-10-31 --dry-run` 끝 코드 0(세션 0개 — 그날 끝난 세션 없음, 드라이버 내려받기·JDBC 읽기 확인).
- 2026-11-01 서버 PC `integration_test.sh --quick`: PASS 84 / FAIL 0 / SKIP 2. 15단계 4개 PASS — 시험 계정 2명 J2 실행(넣음 2), 저장 행이 `/report/sessions`로 만든 기대값과 같음(A 유효 85.0·good 15.0·붕괴 1·알림 이벤트 1, B 유효 4.0·good 4.0, 붕괴까지 NULL), 재실행 지움 2·넣음 2로 같은 행, 시험 데이터 삭제 뒤 `daily_stat` 행도 사라짐(CASCADE).
- 남은 한계: 서버 시험은 5분 미만 세션뿐이라 「붕괴까지 걸린 시간」 값은 로컬 계산 시험으로만 확인했다. 실제 사용자 데이터로 돌린 결과는 cron 등록 뒤 확인.
