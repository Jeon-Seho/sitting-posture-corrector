# 로컬 API·CEP 수직 흐름

사용자 승인에 따라 Java 21·Spring Boot 3.5.16·Maven·Esper 9.0.0을 사용한다.
Spring Boot API는 입력 검증·전달·저장·조회만 담당한다. 독립 CEP 프로세스가 이벤트 시간과
붕괴·회복·재알림을 판정한다. FastAPI는 특징에서 현재 추론 점수를 만든다.
학습된 LSTM, 미래 예측, 사용자별 재학습은 구현하지 않았다.

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

수동 실행은 각각 별도 터미널에서 한다. 먼저 `check-backend`를 완료해야 한다.

```sh
make dev-cep        # 127.0.0.1:8091
make dev-api        # 127.0.0.1:8090, CEP loopback 호출만 허용
make dev-inference  # 127.0.0.1:8092
```

현재 프론트는 기존 로컬 저장/판정 모드를 유지한다. 서버에 실제 특징·영상·좌표를 자동 전송하지 않는다.
서버 모드 연결 시 로컬 시간 엔진을 함께 실행하지 않고 CEP 사건을 표시하도록 별도 전환해야 한다.

## API

| 경로 | 역할 |
| --- | --- |
| `PUT /v1/sessions/{UUID}` | 클라이언트 생성 UUID와 설정으로 세션 생성. 같은 설정의 재시도는 멱등 |
| `POST /v1/sessions/{UUID}/observations` | v2 추론 관측을 CEP에 전달하고 반환 snapshot 저장 |
| `GET /v1/sessions/{UUID}` | 마지막 성공 snapshot 조회. CEP 장애가 있어도 보존 |
| `POST /v1/sessions/{UUID}/end` | 종료 시각으로 종료. 동일 종료 재시도는 멱등 |
| CEP `/internal/sessions/{UUID}` 및 같은 하위 경로 | 독립 시간 판정. API와 이벤트 계약을 공유 |
| FastAPI `POST /v1/infer` | 정규화된 특징 변화량을 현재 점수/유효성/유형으로 변환 |

세션 생성 body:

```json
{"policy":{"hold_ms":3000,"recovery_ms":2000,"reminder_ms":60000,"threshold":0.7}}
```

커스텀 시간·임계값은 생성 시 고정하고 재시도로 바꾸지 않는다. 기본 3초는 붕괴 지속,
60초는 같은 사건의 재알림이다. 복귀 2초는 기존값 보존이며 제품 최종 결정이 아니다.

FastAPI 입력(수작업 합성):

```json
{"schema_version":"1.0","sequence":0,"start_ms":0,"end_ms":1000,"phase":"running","measurement_quality":"good","features":{"forward_delta":0.9,"lateral_delta":0.1}}
```

`forward_delta`, `lateral_delta`는 이미 기준으로 정규화된 [-1,1] 변화량이라는 임시 특징 계약이다.
최대 절댓값을 점수로 사용한다. `collapse_probability`라는 전송 필드는 **보정된 확률이 아닌 규칙 점수**다.
`model_version=baseline-feature-rule-v1`, `learned=false`를 명시한다. 학습 성능이나 의료 판단을 뜻하지 않는다.
저품질/특징 없음/휴식/자리 비움은 `valid=false`이고 정상 관측으로 보충하지 않는다.
FastAPI에는 지속시간·회복시간·재알림 판정과 저장이 없다.

## 시간·이벤트 계약

[관측 v2](../contracts/posture-observation.v2.schema.json), [사건 v1](../contracts/posture-event.v1.schema.json),
[조회 snapshot v1](../contracts/session-view.v1.schema.json), [합성 예제](../contracts/examples/v2/synthetic-observation.json).
기존 상태 v1의 `duration_ms`를 추론 서비스에 요구하지 않고 새 v2를 병행한다.

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
- `legacy-interrupt-v1`은 현재 프론트처럼 휴식·자리 비움·저품질·누락 때 열린 사건을 중단하고
  연속 붕괴/회복 누적을 비운다. 다음 지속 구간은 새 사건이 된다. 이 동작은 기존값을 보존한
  개발 정책이며, **휴식 제외 통계 승인으로 알림 타이머 pause/resume를 확정한 것이 아니다**.

## 통계와 저장

유효 시간 = running이면서 측정 가능한 관측 시간. 휴식·자리 비움·저품질·누락은 제외한다.
유효 시간 0이면 유지율/시간당 사건 수는 null이고, 간격 표본이 없으면 평균도 null이다.
붕괴 주기는 **같은 세션의 연속 확정 사건 발생점 사이 유효 시간** 차이다. 다른 세션은 연결하지 않는다.
원래 시작 시각과 그때까지의 누적 유효 시간을 사건에 함께 보관하여 휴식을 정확히 제외한다.
프론트 신규 사건도 선택 필드 `validStartAt`을 보관한다. 과거 기록은 같은 연속 블록만 계산하고
제외 시간을 알 수 없는 블록 사이 간격은 추측하지 않는다. 기존 데이터는 다시 쓰지 않는다.

저장은 프로세스 내 메모리이며 재시작하면 사라진다. 외부 DB·계정·복구·동의/삭제 API는 아직 없다.
개발 제한은 각 서비스 64세션, CEP 세션당 10,000관측, 경과 시각 최대 24시간이다.
원본 영상·좌표·특징·계정 정보를 저장하지 않는다. CEP는 재시도용 추론 출력만 보관한다.
CEP 실패 시 API는 502를 반환하며 마지막 성공 snapshot을 유지한다. 같은 관측으로 재시도해야 한다.

## 다음 결정

1. 정상 복귀 유지시간: 기존 2초를 유지하며 대상 기기 검증 후 최종 합의한다.
2. 휴식 후 알림: 현재 중단/새 사건을 유지할지, 같은 사건에서 타이머를 동결·재개할지 별도 결정한다.
3. 영구 저장·사용자 격리: DB/인증/멱등성/삭제/동의 계약과 안전한 자격증명 설정 승인 후 도입한다.
4. Kafka: 관측/사건 전달, 파티션 세션 키·중복 처리·백프레셔·재생 계약이 선행한다.
5. Redis: 상태 복구·캐시 목적과 TTL/일관성/CEP 재구성 계약이 선행한다.
6. HDFS/Spark: 승인된 연구 데이터 보관·분석 목적, 동의·분할·보존 정책이 선행한다.
7. 학습 모델/실제 특징 어댑터: 입력 정의·수집 승인·참여자 분할 검증 이후 연결한다. 미래 예측/개별 재학습은 필수 범위가 아니다.
