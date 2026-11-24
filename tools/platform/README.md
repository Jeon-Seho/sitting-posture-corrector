# 플랫폼 시험 도구

빅데이터 플랫폼([infra/compose/bigdata.yaml](../../infra/compose/bigdata.yaml))을 서버 PC에서 확인하는 도구다.
모두 저장소 루트 기준 경로로 실행한다. 참가자·부하 CSV와 결과 폴더는 Git에 넣지 않는다(`.gitignore`).

| 파일 | 용도 |
| --- | --- |
| `integration_test.sh` | 통합 테스트(컨테이너·Kafka·Redis·HDFS·Spark·서비스·Kafka 종단 판정, io-api가 있으면 입출구 REST, `REPORT_TEST_FIXTURES_ENABLED=true`면 판정 결과 저장 11단계, io-api가 있으면 실시간 WebSocket 왕복 12단계, web이 있으면 FE ↔ BE 연동 13단계 — 화면 nginx 경유(T-13)). `--quick`·`--no-e2e`·`--restart`·`--kafka`(12~14단계를 kafka 경로로 — io-api를 잠시 `POSEGOOD_REALTIME_PIPELINE=kafka`로 띄워 직접·화면·터널 WebSocket 왕복, lag 0·DLQ 그대로 확인 뒤 되돌림, D-57) |
| `replay_realtime.py` | Kafka 계약 경로 재생(시험용 입구) |
| `io_api_smoke.py` | 입출구 서버(io-api) REST 점검 — 합성 계정으로 가입·로그인·토큰 갱신(A8)·기준·세션(S1 생성·S4 조회)·기록(R1 목록)·로그아웃·탈퇴(통합 테스트 10단계, D-48). S3(REST 종료)·R3(기록 삭제)는 서비스에서 쓰지 않아 보지 않는다(D-88) — 기대 PASS 20. 측정 입력은 하지 않는다 — REST 구간 입력 S2·메타데이터 S5·세션 삭제 S6는 API에서 지워졌고(계획 0062) 측정은 `ws_realtime_smoke.py`가 본다(D-75). 토큰 로그인(ADR 0031): `Authorization: Bearer`, 로그인 유지 쿠키는 직접 다뤄 Secure 쿠키도 http 시험 주소로 보낸다(D-69). `--base`에 FE nginx(`http://127.0.0.1:8088/api`)도 된다(13단계) |
| `ws_realtime_smoke.py` | 실시간 WebSocket 왕복 점검 — 앱처럼 `/realtime`에 합성 좌표 167구간을 보내 decision·alert·closed와 DB 기록(`--report` 처리 서비스)을 확인. 인증은 `hello.access_token`, 틀린 토큰이면 `closed(unauthorized)`(D-69). 판정 경로 local·kafka 둘 다 같은 기대값(통합 테스트 12단계, 계획 0031 3단계). 끝에서 시험 기록을 R3 `DELETE /records/{id}`로 지운다(D-75). `--base`가 `…/api`면 그 경로로(13단계). 표준 라이브러리만 |
| `test_db_connection.py` | 외부 MySQL 접속 확인 — 확정 서비스 DB(`SERVICE_DB_SCHEMA`, `--env-file infra/compose/.env`) |
| `requirements.txt` | 위 도구의 Python 의존성 |


**가입 이메일 인증이 켜진 서버 — 고정 시험 계정 (D-108)**: `POSEGOOD_EMAIL_VERIFICATION_ENABLED=true`면 가입에 메일로 받은 6자리 코드가
필요해 `io_api_smoke.py`·`ws_realtime_smoke.py`가 매회 합성 계정으로 가입할 수 없다. 그래서 통합 테스트는 고정 시험 계정으로 로그인하고
(`--account-file`), 가입(A2)·탈퇴(A7)와 탈퇴 뒤 검사는 SKIP으로 남긴다(탈퇴한 이메일은 J3가 지우는 30일 뒤까지 다시 가입할 수 없어 탈퇴하지 않는다).
계정은 팀이 메일을 받을 수 있는 주소로 앱에서 한 번 가입해 두고, 그 계정은 시험 전용으로 쓴다(앱에서 측정하면 409 `MEASUREMENT_IN_PROGRESS`가 날 수 있다).

```bash
# 권한 600 — secrets/는 Git 제외, 컨테이너에는 마운트하지 않는다. 비밀번호는 화면에 보이지 않게 입력
( umask 077; read -rp "email: " E; read -rsp "password: " P; echo
  printf '%s\n%s\n' "$E" "$P" | python3 -c 'import json,sys;e,p=sys.stdin.read().split("\n")[:2];print(json.dumps({"email":e,"password":p}))' \
    > infra/compose/secrets/it-test-account.json )
```

통합 테스트 0단계가 인증이 켜졌는데 파일이 없거나 형식이 다르면 FAIL. 인증이 꺼져 있으면 파일이 있어도 지금처럼 매회 합성 계정으로 가입·탈퇴한다.

(D-38, 10/21) 옛 `posture.summary` 경로 도구(T-10 CSV 생성·재생 `generate_collapse_test_csv.py`·`replay_posture_pilot_csv.py`,
부하 측정 `generate_load_test_csv.py`·`rebase_csv_to_now.py`·`run_capacity_stage.sh`)는 옛 경로와 함께 지웠다. 부하 재측정(T-14)은 Kafka 경로 도구로 새로 만든다.
Spark↔HDFS Parquet 왕복 점검 코드는 `tests/hdfs_parquet_roundtrip.py`(통합 테스트 5단계, D-64)다.

```sh
pip install -r tools/platform/requirements.txt
tools/platform/integration_test.sh --quick
```
