# 로컬 특징 추론·API·CEP 흐름

- 분야: 백엔드
- 작업: GP-0068
사용자 승인에 따라 Java 21·Spring Boot 3.5.16·Maven·Esper 9.0.0을 사용한다.
Spring Boot API는 입력 검증·전달·저장·조회만 담당한다. 독립 CEP 프로세스가 이벤트 시간과
붕괴·회복·재알림을 판정한다. FastAPI는 특징에서 현재 추론 점수를 만든다.
학습된 LSTM, 미래 예측, 사용자별 재학습은 구현하지 않았다.

## MySQL 계정 모드

[Compose 안내](../infra/README.md)의 초기화와 `docker compose up`으로 실행한다.
API의 `persistent` 프로필은 MySQL JDBC·Spring Security·DB 세션을 사용한다. 저장 구조는
[DB 스키마 V1.1](../database/README.md)이며 API는 시작할 때 스키마·시드를 확인만 한다([ADR 0018](../docs/decisions/0018-db-schema-v11-service-storage.md)).
가입/로그인·CSRF·계정별 프로필/설정/기록·삭제는 [계정 API v1](../contracts/accounts.v1.md)을 따른다.
메모리 개발 모드와 구분한다. 인증한 사용자만 자기 측정을 조회/입력/종료하며 다른 사용자 세션은 404다.

API는 `account/`에서 인증, `persistence/`에서 JDBC와 계정 잠금, `PersistentSessionService`에서 처리 순서,
`PersistentCepCoordinator`에서 내구 전달/재생을 담당한다. 추론 출력·요청 hash·outbox를 CEP 전에 저장하고
확인 snapshot·사건·완료를 짧은 트랜잭션으로 기록한다. HTTP 동안 행 트랜잭션을 유지하지 않는다.
API 또는 CEP 재시작에 확인 관측을 재생하고 원 미확인 입력을 재전달한다. 요약만으로 빈 세션을 만들지 않는다.
삭제는 DB cascade와 내구 CEP 정리를 사용한다. 기존 관측/사건/조회와 3/2/60 판정은 유지한다.

`make check`는 실제 MySQL·Compose·계정 브라우저까지 실행한다. `make check-local`은 메모리 모드 검증이다.
`-Pmysql-integration verify`는 disposable/synthetic 환경 표시와 실제 DB를 요구하며 미연결을 skip하지 않는다.
[DB 마이그레이션](../database/README.md), [플랫폼 책임](../docs/design/data-platform-boundary.md)을 참고한다.

## 코드 구조

Maven의 `contracts`, `api`, `cep` 모듈과 실행 진입점은 유지하고 각 서비스 안에서 책임별 패키지를 나눈다.

```text
backend/
├── contracts/src/main/java/org/posegood/contracts/  # 서비스 공통 요청·응답 record
├── api/src/main/java/org/posegood/api/
│   ├── ApiApplication.java
│   ├── web/           # HTTP 매핑, 입력 검증, 오류 응답
│   ├── application/   # 요청 순서·특징 재시도·추론/CEP 응답 검증
│   ├── repository/    # 마지막 성공 snapshot의 메모리 저장
│   └── gateway/       # 추론/CEP HTTP 통신과 오류 변환
└── cep/src/main/java/org/posegood/cep/
    ├── CepApplication.java
    ├── web/           # 내부 HTTP 매핑, 입력 검증, 오류 응답
    ├── application/   # 세션 엔진 수명, 입력 순서·재시도·종료
    ├── domain/        # 관측 시간 누적, 사건 기록·통계
    └── esper/         # Esper 설정·EPL 컴파일·배포·호출
```

API 흐름은 `SessionController → SessionService → FeatureProcessor → InferenceGateway / CepGateway`다.
기존 관측·생성·종료·조회도 `SessionService`를 통한다.
세션별 잠금을 추론/CEP 호출부터 snapshot 교체까지 유지하고, 실패하면 마지막 성공 값을 보존한다.
저장소는 HTTP 호출이나 판정을 수행하지 않는다.

CEP의 `SessionEngine`은 순서 검증과 처리를 조율한다. `ObservationTimeline`은 시간만 누적하고,
`EpisodeLedger`는 EPL이 승인한 사건과 통계를 기록한다. `EsperDecisionRuntime`은 런타임을 관리한다.
붕괴·회복·재알림의 시간 임계값 비교는 기존 `src/main/resources/rules/posture.epl`에만 둔다.
테스트는 HTTP 계약, API application service, CEP session engine 책임에 맞는 패키지에 둔다.

## 준비와 검증

Node 24+, Python 3.9+, JDK 21, Maven 3.6.3+를 준비한다. 시스템 설치가 필수는 아니다.
JDK는 `JAVA_HOME`, Maven은 PATH 또는 `MAVEN_EXECUTABLE`로 지정할 수 있다.
의존성은 Maven Central/PyPI에서 받으며 개인 Maven 설정·자격증명을 사용하지 않는다.
기본 Maven 캐시는 저장소의 `.cache/maven`이고 `POSEGOOD_MAVEN_CACHE`로 별도 개발 캐시를 지정할 수 있다.

```sh
make setup
make check-backend
make check
```

Windows: `python tools/dev.py setup`, `python tools/dev.py check-backend`, `python tools/dev.py check`.
`check-backend`는 실제 Java 테스트·패키지를 만들고 세 서비스를 임시 loopback 포트에서 실행한다.
합성 HTTP 흐름 후 성공·실패와 관계없이 시작한 시험 서버를 종료하고 포트 해제를 검사한다.
CEP는 eager startup에서 EPL 컴파일·런타임 배포·첫 빈 상태 처리를 준비하고 임시 런타임을 종료한다.
첫 세션 요청에 초기 준비 비용을 몰지 않으며, 준비용 런타임은 사용자 세션 한도나 통계에 들어가지 않는다.
준비 실패 시 서비스 시작을 실패시켜 HTTP 준비 상태로 노출하지 않는다.

전체 `make check`는 Chrome/Chromium을 사용하는 합성 브라우저 게이트도 실행한다.
`make check-browser` 별도 실행에는 프론트 프로덕션 빌드와 서버 JAR가 필요하며 실제 카메라·외부 계정을 사용하지 않는다.
재알림·처리 후 응답 유실·개발 한도와 브라우저 복구 검증의 최신 범위는
[완료 기록](../docs/plans/completed/0015-server-regression-and-record-details.md)을 따른다.

`check-backend`는 짧은 합성 benchmark 회귀도 실행한다. 성공 응답 계약과 실패 수·서버 정리를 확인하며
미확정 지연 기준은 적용하지 않는다. 별도 `make benchmark-server`의 조건·결과 JSON은
[서버 benchmark 안내](../docs/audits/2026-10-01-server-benchmark.md)를 따른다.

수동 실행은 각각 별도 터미널에서 한다. 먼저 `check-backend`를 완료해야 한다.

```sh
make dev-cep        # 127.0.0.1:8091
make dev-api        # 127.0.0.1:8090, CEP loopback 호출만 허용
make dev-inference  # 127.0.0.1:8092
```

프론트 기본값은 기존 로컬 저장/판정 모드다. 측정 준비의 **서버 판정 사용 · 개발 연결**을 선택하면
기준 대비 세 변화량·품질만 같은 출처 `/api` 프록시로 전송한다. 영상·랜드마크는 전송하지 않는다.
서버 모드에서는 CEP 사건·통계만 표시하고 로컬 시간 판정이나 계약에 없는 진행률을 함께 계산하지 않는다.

```sh
make dev-server
```

이 명령은 세 서비스와 Vite 프록시를 임시 loopback 포트에서 함께 실행하고 접속 주소를 출력한다.
Windows는 `python tools/dev.py dev-server`를 사용한다. `Ctrl+C`로 시작한 프로세스를 정리한다.
수동 Vite 실행은 기본 `http://127.0.0.1:8090` API에 연결하며 `POSEGOOD_API_URL`로
다른 loopback HTTP 포트를 지정할 수 있다. 이 개발 명령은 메모리 모드다. 실제 계정은 Compose로 실행하며 외부 배포 대상은 아직 미정이다.

## API

| 경로 | 역할 |
| --- | --- |
| `PUT /v1/sessions/{UUID}` | 클라이언트 생성 UUID와 설정으로 세션 생성. 같은 설정의 재시도는 멱등 |
| `POST /v1/sessions/{UUID}/features` | 특징 입력 v2 → FastAPI 추론 v2 → CEP. 관측 v2와 조회 v1의 응답 envelope 반환 |
| `POST /v1/sessions/{UUID}/observations` | v2 추론 관측을 CEP에 전달하고 반환 snapshot 저장 |
| `GET /v1/sessions/{UUID}` | 마지막 성공 snapshot 조회. CEP 장애가 있어도 보존 |
| `POST /v1/sessions/{UUID}/end` | 종료 시각으로 종료. 동일 종료 재시도는 멱등 |
| CEP `/internal/sessions/{UUID}` 및 같은 하위 경로 | 독립 시간 판정. API와 이벤트 계약을 공유 |
| FastAPI `POST /v2/infer` | 세 기준 변화량·양쪽 품질을 현재 점수/유효성/유형으로 변환 |
| FastAPI `POST /v1/infer` | 기존 두 임시 특징의 추론 계약 보존 |

세션 생성 body:

```json
{"policy":{"hold_ms":3000,"recovery_ms":2000,"reminder_ms":60000,"threshold":0.7}}
```

[ADR 0012](../docs/decisions/0012-session-timing-policy.md)에 따라 기본 시간 정책을 확정했다.
연속 이탈 3초에 최초 알림, 기준 내 자세를 연속 2초 유지하면 복귀, 같은 사건의 마지막 알림부터
60초가 지나고 이탈 중이면 재알림한다. 60초는 모든 사건에 공통으로 적용하는 알림 간격이 아니다.
복귀 후 새 이탈이 지속되면 새로운 사건의 최초 알림을 판정한다.

커스텀 시간·임계값은 세션 생성 시 고정하고 재시도로 바꾸지 않는다.
사용자가 설정을 변경하면 다음 측정 세션부터 적용하며 진행 중인 세션의 정책은 유지한다.

새 [특징 입력 v2](../contracts/inference-request.v2.schema.json)의
[수작업 합성 요청](../contracts/examples/v2/synthetic-feature-request.json)은 세 기준 변화량을 사용한다.
`baseline_id`는 카메라 기준 등록 UUID의 `8-4-4-4-12` 문자열이며 참여자 식별자가 아니다.
변화량은 어깨 너비로 정규화한 현재−기준 값이고 유한수만 허용한다. `[-1,1]`로 자르지 않는다.

```text
점수 = min(1, max(|head_gap_delta|/0.22,
                  |lateral_offset_delta|/0.20,
                  |shoulder_tilt_delta|/0.13) * 0.7)
```

현재·기준 품질은 각각 `[0,1]`이며 둘 다 0.65 이상, `running/good`, 특징 존재일 때만 유효하다.
그 외에는 `valid=false`, 점수 0, 유형 `none`이다. 유효 점수 0도 `none`이다.
좌우 변화가 다른 두 변화보다 엄격히 우세하면 원본 양수는 미러 화면의 `left_lean`, 음수는 `right_lean`이다.
머리 높이·어깨 기울기 우세나 동점은 `unspecified`이며 전방 굽힘으로 단정하지 않는다.
`model_version=reference-feature-rule-v1`이고 학습 모델이 아니다.
품질 0.65·특징 스케일·점수 계수·판정 임계값은 검증 전 규칙이다.
`collapse_probability`라는 전송 필드는 **보정된 확률이 아닌 규칙 점수**다.

브라우저의 실험용 어댑터는 인접한 실제 프레임 시각 사이의 구간을 사용한다.
첫 프레임은 시작점만 제공하고 양 끝 특징 품질을 검사한다. 기존 1초 유효기간을 넘는 공백은
입력을 중단하며 유효 관측으로 확대하지 않는다. 구간을 대표하는 현재 끝점 특징과 품질 성능은 실기기 검증이 필요하다.
휴식·공백·설정은 [시간 정책](../docs/decisions/0012-session-timing-policy.md)을 유지한다.

기존 FastAPI v1 입력도 유지한다(수작업 합성):

```json
{"schema_version":"1.0","sequence":0,"start_ms":0,"end_ms":1000,"phase":"running","measurement_quality":"good","features":{"forward_delta":0.9,"lateral_delta":0.1}}
```

`forward_delta`, `lateral_delta`는 이미 기준으로 정규화된 [-1,1] 변화량이라는 임시 특징 계약이다.
최대 절댓값을 점수로 사용한다. v2의 점수·좌우 방향 규칙으로 기존 v1을 다시 해석하지 않는다.
`model_version=baseline-feature-rule-v1`, `learned=false`를 명시한다. 학습 성능이나 의료 판단을 뜻하지 않는다.
저품질/특징 없음/휴식/자리 비움은 `valid=false`이고 정상 관측으로 보충하지 않는다.
FastAPI에는 지속시간·회복시간·재알림 판정과 저장이 없다.

## 시간·이벤트 계약

[관측 v2](../contracts/posture-observation.v2.schema.json), [사건 v1](../contracts/posture-event.v1.schema.json),
[조회 snapshot v1](../contracts/session-view.v1.schema.json), [합성 예제](../contracts/examples/v2/synthetic-observation.json).
기존 상태 v1의 `duration_ms`를 추론 서비스에 요구하지 않고 새 v2를 병행한다.
[특징 응답 v1](../contracts/feature-response.v1.schema.json)은 관측 v2와 조회 v1을 함께 반환하며
원본 특징·기준 UUID를 응답에 넣지 않는다.

- 관측은 세션 시작 기준 `[start_ms,end_ms)` 한 구간의 추론 결과를 뜻한다. 1..1500ms만 수용한다.
  단일 프레임을 긴 구간의 관측으로 확대하지 않는다. 향후 실제 프레임 어댑터의 구간 정의 검증은 별도다.
- 순서는 sequence와 구간으로 확인한다. 동일 sequence/동일 body 재시도는 집계와 알림을 늘리지 않는다.
  다른 body 중복·역순·겹친 구간은 409이며 상태를 바꾸지 않는다. sequence 유실도 연속 판정을 끊는다.
- 타임스탬프 공백은 `missing_ms`로 제외한다. 종료 이후 새 입력은 409다.
- 모든 시간 임계값 비교는 `cep/src/main/resources/rules/posture.epl`에만 있다.
  Java CEP는 연속 시간과 사건/집계 상태를 누적하고 EPL 결정을 반영한다. API는 이를 재판정하지 않는다.
- `collapse_confirmed`는 최초 알림 1회와 같은 사건이다. `reminder`는 같은 사건 재알림,
  `recovery_confirmed`는 설정만큼 정상 유지한 회복이다. 중단을 회복으로 간주하지 않는다.
  알림 횟수는 CEP의 알림 결정 수이며 실제 화면 전달/소리 재생 성공을 뜻하지 않는다.
- 휴식·자리 비움·저품질·누락 때 열린 사건을 중단하고 연속 붕괴/회복 누적을 비운다.
  휴식 이후에는 새로 시작하며 다음 이탈이 설정 시간만큼 지속되면 새 사건이 된다.
  저품질·누락은 연속 판정을 끊고 통계에서 제외하며 정상 관측이나 복귀로 보충하지 않는다.
  이 확정 동작의 기존 전송 이름 `legacy-interrupt-v1`은 계약 호환성을 위해 유지한다.
  휴식 전 누적이나 재알림 타이머를 동결했다가 재개하는 방식으로 바꾸지 않는다.

## 통계와 저장

유효 시간 = running이면서 측정 가능한 관측 시간. 휴식·자리 비움·저품질·누락은 제외한다.
유효 시간 0이면 유지율/시간당 사건 수는 null이고, 간격 표본이 없으면 평균도 null이다.
붕괴 주기는 **같은 세션의 연속 확정 사건 발생점 사이 유효 시간** 차이다. 다른 세션은 연결하지 않는다.
원래 시작 시각과 그때까지의 누적 유효 시간을 사건에 함께 보관하여 휴식을 정확히 제외한다.
프론트 신규 사건도 선택 필드 `validStartAt`을 보관한다. 과거 기록은 같은 연속 블록만 계산하고
제외 시간을 알 수 없는 블록 사이 간격은 추측하지 않는다. 기존 데이터는 다시 쓰지 않는다.

아래 개발 모드 저장은 프로세스 내 메모리이며 재시작하면 사라진다. Compose의 MySQL 영구 모드는 위 계정 API와 내구 복구/삭제를 사용한다.
개발 제한은 각 서비스 64세션, CEP 세션당 10,000관측, 경과 시각 최대 24시간이다.
API도 세션당 최대 10,000건의 특징 요청 hash·원 추론 출력·확정 거부 상태를 보관한다.
원본 영상·좌표·원 요청 특징·계정 정보를 서버에 저장하지 않는다.
CEP는 재시도용 추론 관측과 사건·통계를 보관한다.

## 특징 재시도와 실패

API는 검증한 요청 필드의 SHA-256으로 중복을 비교하고 추론 성공 후 세션의 기준 UUID를 고정한다.
개발 v2 경로는 `reference-feature-rule-v1` 모델명만 허용하며 다른 모델 출력은 502다.
낮은 현재·기준 품질을 유효하다고 반환하는 추론 출력도 502로 거부하여 CEP 집계에 넣지 않는다.
동일 sequence·동일 내용 재시도는 원 추론 출력을 재사용한다. 응답의 조회는 최신 확인 요약이다.
이미 수용한 요청을 다시 보내거나 종료 후 같은 요청을 조회해도 집계·알림을 늘리지 않는다.

| 결과 | 처리 |
| --- | --- |
| API 400 / FastAPI 422 | 입력 계약 위반. 오류 응답에 특징 값을 반영하지 않는다. |
| 409 충돌 | 다른 내용의 중복, 역순·겹침, 변경한 기준·설정, 종료 후 새 입력을 거부한다. |
| 502 추론 실패·응답 불일치 | 마지막 성공 요약 보존. 원출력이 없으면 같은 요청 재시도 때 추론을 다시 호출한다. |
| 502 CEP 미확인 | 추론 원출력을 pending으로 보존한다. 같은 특징 요청을 먼저 재시도해야 하며 후속 관측·종료는 409다. |
| CEP 확정 409/429 | 거부 상태를 cache하고 pending을 해제한다. 재시도는 같은 거부를 반환하며 종료할 수 있다. API 한도 429도 종료를 막지 않는다. |
| 404 | 메모리 세션 없음. 서버 재시작에 의한 유실을 영구 복구·성공한 종료로 표시하지 않는다. |

프론트는 기본 16개 한도의 큐를 한 요청씩 전송한다. 검증한 응답과 중간 기록 저장이 끝나야
큐 앞 요청을 제거한다. 시간 초과·연결 실패·저장 실패는 입력을 멈추고 정확히 같은 요청을 유지한다.
확정 특징 거부는 서버 조회로 확인 상태를 맞춘 뒤 종료한다. 새로고침은 미확인 요청 하나와
마지막 확인 요약·기준/장치 정보를 보존한다. 아직 전송하지 않은 큐 전체의 복구를 보장하지 않는다.
기준 특징·미확인 변화량은 브라우저 복구용 임시 자료이며 종료 결과 저장 성공 후 정리한다.
복구 후 직접 카메라 위치를 확인하고 재개한다. 404의 기존 세션을 같은 UUID의 빈 세션으로 대체하지 않는다.

상세 결정은 [ADR 0013](../docs/decisions/0013-frontend-server-feature-connection.md),
영구 복구·소유권의 후속 설계는 [DB·인증 설계](../docs/design/server-persistence-and-auth.md)를 따른다.

## 다음 결정

1. 운영 계정/DB 정책: 자동 보존·백업 만료/삭제·비밀번호 분실 복구·이메일 소유 확인·기기 간 활성 세션 복구를 실제 운영 요구로 정한다. MySQL·이메일 비밀번호와 기본 영구 저장은 구현했다.
2. Kafka: 관측/사건 전달, 파티션 세션 키·중복 처리·백프레셔·재생 계약이 선행한다.
3. Redis: 상태 복구·캐시 목적과 TTL/일관성/CEP 재구성 계약이 선행한다.
4. HDFS/Spark: 승인된 연구 데이터 보관·분석 목적, 동의·분할·보존 정책이 선행한다.
5. 학습 모델/실제 특징 검증: 현재 어댑터와 임시 규칙을 실기기·참여자 분할로 검증한 뒤 확장한다. 수집 승인은 별도이며 미래 예측/개별 재학습은 필수 범위가 아니다.
