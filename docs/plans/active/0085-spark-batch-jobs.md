# Spark 배치 J2 → J3 → J1 (일별 통계·탈퇴 삭제·HDFS 적재)

- 상태: in_progress (J2·J3·J1 서버 확인 2026-11-01 — 남은 것: J1 실제 데이터는 D-57 뒤, DB README 구현 상태는 DB/BE)
- 담당: DevOps/BE (ghdrb1246)
- 시작일: 2026-11-01
- 관련: [database/README.md](../../../database/README.md) 「일별 통계」·「붕괴까지 걸린 시간」·「탈퇴 최종 삭제」·「삭제 배치 공통」, `database/schema/schema_V2_6.sql`(`daily_stat`·`deletion_request`·`feature_archive`), [아키텍처 v5.4 스택별 역할](../../design/architecture_v5.4_stack_roles.md) 적재·분석 층, [bigdata/README.md](../../../bigdata/README.md)

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
- [x] J2 cron 등록(서버 PC crontab, 00:10 — 서버 시간대 KST, 2026-11-01)
- [x] J3 구현·흐름 시험(가짜 DB·HDFS), 통합 테스트 16단계
- [x] J3 서버 확인(통합 테스트 16단계)
- [x] J3 cron 등록(04:00, 2026-11-01)
- [x] J1 구현·로컬 시험(로컬 Spark·파일), 통합 테스트 17단계
- [x] J1 서버 확인(통합 테스트 17단계)
- [x] J1 cron 등록(매시간 20분, 2026-11-01)
- [x] PR #93 develop 병합(2026-11-03)
- [ ] J2 최근 N일 다시 계산(D-81) — 서버 확인·cron `--days 7`
- [ ] 문서 동기화(DB README 「구현 상태」는 DB/BE에 알림)

## 결정과 진행 기록

- 2026-11-01: 한 브랜치에서 J2 → J3 → J1, 잡마다 커밋(사용자 지시).
- J2 대상은 **끝난 세션만**(`ended_at` 있음). 판정 상태를 잃고 닫히지 않은 행(R2 삭제로 생김)은 넣지 않는다 — 닫는 방법은 DB/BE 몫(계획 0062 남은 일).
- 길이 0인 「붕괴까지」 구간(붕괴가 세션 끝까지 이어진 뒤)은 표본으로 치지 않는다.
- J2 시각 00:10 — 자정 직전 세션 저장·자정 넘김 저장을 기다림(FE 제안서 BE-11 요청).
- 쓰기는 Spark JDBC(upsert 없음) 대신 드라이버 JVM의 JDBC 연결로 「그날 행 지우고 다시 넣기」 한 트랜잭션.
- 드라이버는 `--packages com.mysql:mysql-connector-j:8.4.0`(jar를 저장소에 넣지 않음).
- J3 대상 상태에 `PROCESSING`도 넣는다 — DB README는 `REQUESTED`·`FAILED`만 적었지만, 실행기 잠금으로 한 번에 하나만 돌기 때문에 시작할 때 남은 `PROCESSING`은 앞 실행이 중간에 멈춘 것이다(넣지 않으면 영영 남음). DB/BE에 알림.
- J3 성공 때 요청 행은 DB README 순서대로 지운다 — 그래서 `DONE`·`data_deleted_at`은 남지 않는다(완료 기록이 필요하면 DB/BE와 다음 버전에서).
- J3 파일 단계와 행 단계는 따로 확정한다: 파일을 지우고 `deleted_at`을 채운 것은 행 삭제가 실패해도 남아 재시도 지점이 된다.
- J3 시험 데이터 준비(시험 계정을 탈퇴 상태로, 적재 기록·HDFS 폴더)는 `tests/batch_testkit.py`(시험 계정만, 통합 테스트가 컨테이너에 복사) — 처리 서비스 코드를 바꾸지 않아 이미지 재빌드가 없다.
- 완료 안내는 수단이 정해지지 않아 자리만(이메일을 읽지 않음). `RECORDS_ONLY`는 입출구 서버가 만들지 않아 개수만 로그.
- J1 받기는 Structured Streaming `availableNow` + 체크포인트(HDFS) — 읽은 위치를 Spark가 관리해 cron마다 이어 읽는다. 임시 폴더는 `date=` 하위 폴더를 직접 읽는다(맨 위 `_spark_metadata`가 정리로 지운 파일을 가리켜 읽기가 깨지지 않게). 임시 폴더는 `hour=` 없이 `topic=`·`date=`만.
- J1 세션 폴더 파일 3개는 토픽마다 JSON Lines(원문 그대로) — 세션 하나가 작고(2시간 세션도 수만 줄) 학습 쪽에서 그대로 읽을 수 있다. Parquet로 바꾸려면 파일 이름만 바뀐다.
- J1 대상은 DB 기준(`ended_at` 있음 + 10분 지남 + `feature_archive` 없음 + 계정 ACTIVE). Kafka 봉투의 `user_id`는 시험 입구에서 임의 문자열이라 쓰지 않고 DB `user_account_id`로 폴더를 정한다.
- J1 cron은 매시간 20분(J2 00:10·J3 04:00과 겹치지 않게). Kafka 소스 패키지 판은 spark 이미지 태그에서 읽는다(`SPARK_VERSION`으로 덮어쓰기).
- 시험 도구 `tests/j3_testkit.py`를 `tests/batch_testkit.py`로 이름을 바꾸고 `archive-info`(J1 확인)를 더했다.
- 2026-11-04: cron 전 날짜(10/29·10/30)가 `daily_stat`에 없던 것을 찾아 `--date`로 채움(각 1행). J2는 어제만 계산해 다음 날 00:10 뒤에 닫힌 세션을 놓친다는 것도 찾음(D-81).
- 2026-11-08 D-81(사용자 결정): **최근 N일 다시 계산** — `--days N`(기본 1, 최대 31, cron 7)으로 끝 날짜부터 N일 전까지 날짜마다 계산하고, 저장된 행과 같으면 쓰지 않는다(`computed_at` 유지). 늦게 닫힌 세션과 지워진 세션(R3)을 함께 반영한다. 「늦게 닫힌 세션만 찾기」(`computed_at` 비교)는 세션 삭제를 못 잡아 고르지 않음. 한 날짜 실패는 다른 날짜를 막지 않고 끝 코드 1.
- 2026-11-03 운영(D-76): 서버 저장소를 잡 폴더가 없는 브랜치로 바꾸면 spark 바인드 마운트가 지워진 폴더를 가리킨다 — `docker restart spark`.

## 검증 결과와 남은 한계

- 2026-11-01 작업 환경(J1): `python -m pytest tests/test_batch_j1_hdfs_archive.py` 8개 통과(임시 폴더 열·파일 3개·재전송/같은 사건 중복 빼기·구간 시각·임시 폴더에 없는 세션·dry-run·오래된 임시 폴더만 지움·후보 SQL). 받기 부분은 Kafka 대신 파일 스트림으로 `availableNow`·체크포인트(두 번째 실행 0건)·`date=` 하위 폴더 읽기를 따로 확인. Kafka 소스 자체는 서버(17단계)에서.

- 2026-11-01 작업 환경(J3): `python -m pytest tests/test_batch_j3_withdrawal_delete.py` 11개 통과(유예 기준 시각·대상 SQL·성공 순서·실패 되돌림과 FAILED·재시도 때 지운 폴더 건너뜀·다른 사용자 폴더 거부·CLOSED 아님·이미 처리됨·한 사용자 실패가 다음 사용자를 막지 않음·`--grace-days`는 `--user`와 함께). `Hdfs` 도우미는 로컬 파일 시스템(`file:///`)으로 쓰기·있음·폴더째 삭제 확인.

- 2026-11-01 작업 환경: `python -m pytest tests/test_batch_j2_daily_stat.py` — pyspark 4.0.1 로컬, 9개 통과(짧은 세션·제외 구간 자르기·세션마다 버림·알림 이벤트·붕괴까지 구간과 제외 겹침·붕괴 없는 세션·여러 세션 최소/최대·쓰기 SQL·날짜 필터).
- 2026-11-01 서버 PC: spark 컨테이너 다시 만듦(`spark-ivy` 볼륨 생성, `/opt/jobs` 마운트, DB 환경 값 4개 확인). `batch.sh j2 --date 2026-10-31 --dry-run` 끝 코드 0(세션 0개 — 그날 끝난 세션 없음, 드라이버 내려받기·JDBC 읽기 확인).
- 2026-11-01 서버 PC `integration_test.sh --quick`: PASS 84 / FAIL 0 / SKIP 2. 15단계 4개 PASS — 시험 계정 2명 J2 실행(넣음 2), 저장 행이 `/report/sessions`로 만든 기대값과 같음(A 유효 85.0·good 15.0·붕괴 1·알림 이벤트 1, B 유효 4.0·good 4.0, 붕괴까지 NULL), 재실행 지움 2·넣음 2로 같은 행, 시험 데이터 삭제 뒤 `daily_stat` 행도 사라짐(CASCADE).
- 2026-11-01 서버 PC(J3): `batch.sh j3 --dry-run` 끝 코드 0 — 운영 대상 0명(폐쇄 시각 ≤ 10/02, 시험 계정 탈퇴는 10/28부터라 아직). 통합 테스트 `--quick` **PASS 90 / FAIL 0 / SKIP 2** — 16단계 6개 PASS: 준비(C 탈퇴 31일 — 세션·일별 통계·기준 자세·적재 기록·HDFS 폴더, D 탈퇴 29일), dry-run 대상 C만, J3 실행(C 파일 1개·행 6단계 각 1 삭제), C 전부 삭제·HDFS 사용자 폴더 없음·D 그대로, 재실행 삭제 0·실패 0, D `--grace-days 0 --user`로 정리. 15단계(J2) 등 기존 단계 회귀 없음.
- 2026-11-01 서버 PC(J1): `batch.sh j1 --dry-run` 끝 코드 0 — 첫 받기 Kafka 10,104건 → 임시 폴더, 운영 대상 세션 2개는 임시 폴더에 없음(앱 측정이 Kafka를 거치지 않음 — D-57 전). 통합 테스트 1차(19:12) PASS 93 / FAIL 1 — 17단계 대상 0개: 시험 재생은 85초 분량을 1초에 보내 저장된 `ended_at`(시작 + 85.0s)이 아직 미래라 J1 조건(`ended_at ≤ 지금`)에 안 걸림 → 시험이 세션 생성 뒤 90초를 기다리게 고침(J1 코드는 그대로). 2차(20:26) **PASS 94 / FAIL 0 / SKIP 2** — 17단계 4개 PASS: J1 받기 1,863건·적재 1개(user 99, features 172·inference 172·episodes 90 = decision 4 + progress 86), `feature_archive` 1행(`/data/users/99/2026-11-01/<세션>/`, 구간 20:31:05.176 ~ 20:32:30.176 = 시작 + 0 ~ 85.0s), 재실행 새 메시지 0·적재 0, J3가 J1이 쓴 폴더(파일 1개)·`feature_archive` 1행·계정 삭제. 회귀 없음.
- 남은 한계(J1): 실제 사용자 세션은 D-57(앱 측정의 Kafka 경로 전환) 뒤부터 적재된다. 임시 폴더 7일 정리는 오래된 `date=` 폴더 3개 삭제로 서버에서 한 번 확인(19:17).
- 남은 한계(J3): 실패 되돌림·`FAILED` 재시도·다른 사용자 폴더 거부는 흐름 시험(가짜 DB·HDFS)으로만 확인. 완료 안내 발송 없음.
- 남은 한계: 서버 시험은 5분 미만 세션뿐이라 「붕괴까지 걸린 시간」 값은 로컬 계산 시험으로만 확인했다. 실제 사용자 데이터로 돌린 결과는 첫 cron 실행(11/02 00:10) 로그 `batch-logs/j2-*.log`로 확인.
