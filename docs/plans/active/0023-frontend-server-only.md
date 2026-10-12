# 앱 판정 제거와 서버 결과 전용 화면

- 상태: in_progress (1단계 완료, 0단계 팀 결정 대기)
- 담당: FE
- 시작일: 2026-10-11
- 관련 요구사항/ADR: [FE 제안서](../../design/fe-server-proposal.md), [FE 검토](../../design/fe-review.md),
  [Kafka 실시간 전달 계획](0022-kafka-realtime-pipeline.md), [ADR 0013](../../decisions/0013-frontend-server-feature-connection.md),
  DevOps `DevOps` 브랜치 `platform/`(판정 경로), DB 담당 `feature/repo-backend-db-v2`(팀 API, 미병합)

## 배경

지금 앱은 서버 없이도 혼자 판정한다. 점수, 상태(좋음/무너짐/측정 불가), 유형(머리/좌우 기울임), 고개 돌림 제외, 복귀 대기를
브라우저가 계산하고, ML용 CSV에도 앱 판정 라벨을 붙인다. 서버가 없던 시기의 FE 개발·시연용 구성이다.

2026-10-11 팀 결정: **앱은 판정하지 않는다.** 상태·유형 판정, ML용 CSV 판정 라벨, 앱 판정 자체를 모두 없앤다.
라벨 촬영 수집 화면은 BE·ML 요구를 다시 받아 만든다. 서버 개발이 마무리 단계라 이번에 완전히 바꾼다.

## 목표

앱은 **카메라 → 관절 추출 → 정보 전송 → 서버 결과 표시**만 한다.

| | 지금 | 바뀐 뒤 |
|---|---|---|
| 판정 | 앱(로컬) 또는 서버 | 서버만 |
| 서버 없이 실행 | 로컬 모드로 측정 가능 | 측정 불가. 로그인한 서버 모드만 있다 |
| 화면 상태 | 앱 판정 | 서버 `observation`·`progress`·`decision`·`alert` |
| 네트워크 끊김 | 앱 판정으로 계속 | "연결 끊김"을 화면을 막지 않게 표시. 카메라·관절 표시는 계속, 정보는 쌓아 두었다가 재연결 후 재전송 |
| 유형 표시 | 머리/좌우 기울임 | 표시하지 않음 |
| ML용 CSV | 좌표 + 앱 판정 라벨 | 좌표만(라벨 없음) |

## 완료 기준

1. FE 코드(`frontend/src`)에 판정 코드가 없다. 점수·상태·유형·고개 돌림·복귀 대기 계산을 import하는 곳이 없다(검색으로 확인).
2. 서버 없이 측정을 시작하면 이유를 안내하고 시작하지 않는다.
3. 측정 중 화면 상태는 서버 메시지로만 바뀐다. 가짜 서버 메시지를 넣는 컴포넌트 시험으로 확인한다.
4. 연결이 끊겼다 이어지면 밀린 구간을 같은 순번으로 다시 보내고 화면이 서버 결과로 돌아온다. 가짜 서버 시험으로 확인한다.
5. 서버로 넘길 규칙 문서와 합성 시험 데이터(입력 → 기대 결과)가 있고, 서버 담당이 그 데이터로 같은 결과를 확인했다.
6. `make check`(Windows: `python tools/dev.py check`) 통과. 프론트 시험 수·타입·빌드 결과를 기록한다.

## 범위와 제외

- 범위: `frontend/src` 전체(로컬 모드·판정·내보내기·화면), 관련 계약 문서(`contracts/realtime/`, 계정 계약의 동의 버전),
  [데이터 플랫폼 경계](../../design/data-platform-boundary.md)·[세션 내보내기 명세](../../research/session-export.md), 새 ADR.
- 제외: 서버 판정 구현(서버 담당), ML 모델, DB 스키마. 라벨 촬영 수집 화면의 새 요구(BE·ML이 정한 뒤 별도 계획).
- 지키는 것: 실제 영상·랜드마크·참여자 정보는 저장소에 넣지 않는다. 시험은 합성 데이터만 쓴다.

## 작업 단계

### 0단계 — 팀 결정 (제안서로 요청, 1단계 이후 작업의 전제)

- [x] **FE가 붙을 서버.** DevOps Kafka 경로(`platform/`: 추론 → v1 판정기 → `posture.episodes.v1`)로 정했다(v4 결정·현재 운영).
  게이트웨이는 FE의 독립 서비스(`backend/realtime`)다.
- [x] **앱이 보내는 정보.** 좌표 프레임(v4 회의 결정). 관절·형식은 BE·ML 요구를 따른다(FE 초안 `posture.frames.v1`). 게이트웨이는 판정하지 않고 그대로 넘긴다.
- [ ] 팀 API가 `session_started`·`session_ended`를 Kafka에 넣는 일정, 추론이 좌표를 받는 일정([FE 제안서](../../design/fe-server-proposal.md) Q1·Q2).
- [ ] `observation.invalid_reason` 추가(고개 돌림·복귀 대기·측정 불가 안내 문구용).
- [ ] 계약·서버의 유형 필드(`deviation_type` 등)를 없앨지(ML·서버 담당).
- [ ] 브랜치: `lee_app1`(FE 커밋 7개, `develop`에 없음)과 `feature/repo-backend-db-v2`를 `develop`에 넣는 순서.
  둘 다 `model/prototype/pose.ts`·`frontend/src/features/session/server/validation.ts`를 고쳐 충돌한다.

### 1단계 — 서버와 무관한 준비 (지금 시작 가능)

- [x] **규칙 문서와 합성 시험 데이터 작성.** [FE 제안서](../../design/fe-server-proposal.md),
  [합성 시험 데이터](../../../contracts/examples/frames/reference-rule-cases.json)(프레임 16·시간 순서 4·기준 자세 1),
  앱 코드와 손 계산으로 검사하는 `frontend/src/features/session/server/referenceRuleCases.test.ts`.
- [x] **ADR 작성: "앱은 판정하지 않는다".** [ADR 0021](../../decisions/0021-app-sends-information-server-judges.md).
  어긋나는 현재 문서(README, 아키텍처, 제품 범위, 데이터 플랫폼 경계, 실시간 계약, 판정 불가 처리, FE 회신, 내보내기·수집 규격,
  계획 0022, 프론트 README, 문서 지도)에 변경 안내를 붙였다. ADR 0012·0013에 일부 대체를 표시했다. 완료 계획·감사 기록은 이력이라 고치지 않았다.
  실시간 계약의 새 스키마(`posture.frames.v1`)는 0단계 뒤에 만든다.

### 2단계 — 앱 판정 제거

- [x] ML용 CSV 판정 라벨(`features_ok`·`state`·`type`·`score`) 제거(10/11): `poseDebugExport.ts`, 세션 내보내기 명세.
  txt(`kafkaExport.ts`)는 지금 서버 입력(특징 변화량) 형식이라 3단계에서 좌표로 바꿀 때 함께 바꾼다.
- [x] 유형 표시 제거(10/11): 측정 화면 상태·힌트 문구, 알림 문구(로컬·서버), 사건 표, 서버 사건 이력의 "방향·유형" 열,
  기록 화면의 "자주 흐트러진 방향" 카드. 저장 데이터의 유형 필드(`CollapseEvent.type`, 계약 `deviation_type`)는
  기존 기록을 계속 읽기 위해 남기고, 로컬 모드 제거와 계약 변경 때 정리한다.
- [ ] 로컬 모드 제거: `LocalServiceApp.tsx`, `LocalHistory.tsx`, `storage/localRepository.ts`·`useLocalWorkspace.ts`, `session/engine/`, `lib/engine.ts`,
  `lib/returnSettle.ts`, `lib/postureScore.ts`와 이를 쓰는 화면. 시연용 예시 기록이 로컬 저장에 기대는지 확인한다.
- [ ] 측정 화면의 점수·상태를 서버 결과 표시로 바꾼다. 서버 없이는 측정을 시작하지 않는다.
- [ ] 라벨 촬영 수집 화면: BE·ML 요구가 올 때까지 판정 라벨만 빼고 둔다.

### 3단계 — 서버 연결 (0단계 결정 후)

- [ ] **기준 자세 등록과 측정 시작 분리**(10/12 결정). 등록은 사용자가 「자세 등록」을 눌렀을 때만 3초 보정을 하고,
  좌표 9개 x·y 평균 18개를 서버에 저장한다(`setup.baseline.landmarks` 형식). 측정 시작은 보정 없이 서버에 저장된 기준을 쓴다.
  저장된 기준이 없으면 측정 시작 대신 등록으로 안내한다. 다시 등록하면 저장 응답을 받은 뒤에 측정을 시작할 수 있다.
  바꿀 곳: `SetupPage.tsx`·`useAutoBaseline.ts`(측정 전 자동 보정과 보정 직후 자동 시작 제거), `useCamera.ts`(기준을 메모리에만 둠),
  `server/setup.ts`(V1.1 특징값 형식 → 좌표 평균). 팀 API 분리([FE 제안서](../../design/fe-server-proposal.md) 10장)가 필요하다.
- [ ] 정보 전송: 0.5초 묶음, 순번·`ack` 재전송·재연결, `phase`(`running`·`calibration`·`rest`·`away`). 카메라 1.5초 이상 끊기면 `away`, 일시정지는 `rest`.
- [ ] 화면 구동: `observation`·`progress`·`decision`·`alert`. `excluded_started/ended`는 받기만 한다. 연결 끊김 표시.
- [ ] 기록 화면: 서버가 세션 테이블로 다시 만든 기록을 그대로 쓴다(`client_record` 없음).

### 4단계 — 동의

- [ ] 가입 동의문에 좌표 전송·학술용 적재를 **필수 동의**로 넣고 새 버전(예: `service-v2`)으로 바꾼다. 서버 검증값도 함께 바꾼다.
  철회하면 측정을 시작할 수 없다고 안내한다(로컬 모드 없음).
- [ ] 동의 저장 위치(`user_consent` 보류 해제)를 DB에 요청한다. 설정의 철회 토글, 측정 준비 화면의 "좌표 전송 안 함" 문구를 고친다.

### 5단계 — 검증과 정리

- [ ] 실패 경로 시험: 서버 없음, 연결 끊김·재연결, 중복·역순 순번, 로그인 만료.
- [ ] `make check`, 서버 담당과 연동 시험(T-13).
- [ ] 문서 갱신: [문서 지도](../../index.md), `frontend/README.md`, [0022 계획](0022-kafka-realtime-pipeline.md)의 "로컬 판정과 선택 공존" 정리.

## 결정과 진행 기록

- 2026-10-11: 앱 판정·라벨 전부 제거, 서버 전용 앱으로 결정. 네트워크 끊김 때 로컬 미리보기는 하지 않는다(앱 판정이 없으므로).
  소리 설정은 저장하지 않는다. 화면 크기는 팀 카메라 전제로 640×480 요청을 유지한다. 좌표 프레임 계약 이름은 `posture.frames.v1`.
- 2026-10-11: 규칙 문서를 쓰며 확인한 사실. 앱은 0.5초로 묶지 않고 이웃한 두 프레임 사이를 구간으로 보낸다.
  "판정 불가 3초 연속 → 측정 멈춤·자동 재개"는 앱에도 구현되지 않았다. 기준 자세를 평균 좌표 18개로 다시 계산하면 앱과 값이 다르다(규칙 문서 3장).
- 2026-10-11: 브라우저 시험(`tools/browser/scenarios.mjs`)이 `871ba31`의 "판정 불가 뒤 3초 보류"를 반영하지 않아 실패했다.
  보류 3초 동안 유효 시간이 늘지 않고 그 뒤 첫 판정 구간부터 늘어나는지 확인하도록 고쳤다. 2단계에서 앱 판정을 없애면 이 시나리오를 다시 쓴다.
- 2026-10-12: **기준 자세 등록과 측정 시작을 별개로 한다.** 지금은 측정할 때마다 3초 보정 뒤 바로 측정이 시작된다.
  앞으로는 등록을 한 번 해 두면 측정 때 보정하지 않는다(DB `baseline_posture`가 사용자당 1행으로 이미 이 구조다).
  측정 좌표는 0.5초마다 8장 정도를 평균 없이 통째로 보내고, 평균은 등록(보정 약 48장 → 18개 한 세트)에서만 낸다.
  카메라·의자 위치가 바뀌었을 때 재등록을 안내하는 기능은 지금 범위에 넣지 않는다.
- 남은 질문: 0단계 전체. 라벨 촬영 수집 화면의 새 요구(BE·ML).

## 검증 결과와 남은 한계

2026-10-11, Windows 11 PC(JDK 21.0.12, Maven 3.9.9, Node 24.14, Python 3.13, Docker Desktop 4.94 / Engine 29.8.2). `make`가 없어 `python tools/dev.py <단계>`로 실행했다.

| 단계 | 결과 |
|---|---|
| `check-repo` | 통과 |
| `test`(Python) | 140개 중 오류 3개, 건너뜀 1개. 모두 `test_deploy_configuration`: Windows 파일 잠금(`WinError 32`) 2개, "SSH 배포는 Linux/POSIX 호스트 필요" 1개. Linux·Mac에서 다시 확인 필요 |
| `check-frontend` | 통과(시험 파일 40개·302개, `tsc -b`, Vite 빌드) |
| `check-backend` | 통과(Maven 모듈 3개, API 시험 59개 중 14개 건너뜀, 서비스 연동 smoke 10개) |
| `check-browser` | 시나리오 수정 후 통과(75개 항목) |
| `check-compose` | **실패.** `infra/mysql/initdb/10-posegood-schema.sh`가 지워진 `schema_V1_1.sql`을 적용하려 해 DB가 비고, API가 V1.1 테이블이 없다며 시작하지 않는다. `develop`도 같다. DB 담당 `feature/repo-backend-db-v2`(`fcc8ef7`)가 스크립트를 `schema_V2_2.sql`로 바꾸고 API를 V2.2에 맞췄다(미병합) |

- 이 계획의 코드 변경(2·3단계)은 아직 하지 않았다.
