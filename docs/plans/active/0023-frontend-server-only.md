# 앱 판정 제거와 서버 결과 전용 화면

- 상태: planned (0단계 팀 결정 대기)
- 담당: FE
- 시작일: 2026-10-11
- 관련 요구사항/ADR: [FE 회신: v4 회의](../../design/v4-meeting-fe-reply.md), [DB V2.1 FE 검토](../../design/db-v21-fe-review.md),
  [Kafka 실시간 전달 계획](0022-kafka-realtime-pipeline.md), [ADR 0013](../../decisions/0013-frontend-server-feature-connection.md),
  DB 담당 `feature/repo-backend-db-v2`의 ADR 0020(미병합), DevOps `DevOps` 브랜치 `platform/`

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

- [ ] **FE가 붙을 서버.** ① DB 담당 단일 Spring API(ADR 0020, `/v1/realtime` WebSocket, Kafka 없음) ② DevOps `platform/`(Kafka, v1 판정기, Redis).
- [ ] **앱이 보내는 정보.** 좌표 프레임(v4 회의 결정, `posture.frames.v1`) / 특징 변화량(ADR 0020이 유지한 ADR 0013).
  FE 제안: 좌표. 앱 판정을 없애는 결정과 일관되고, 특징값 계산도 판정 규칙의 일부다.
- [ ] `observation.invalid_reason` 추가(고개 돌림·복귀 대기·측정 불가 안내 문구용).
- [ ] 계약·서버의 유형 필드(`deviation_type` 등)를 없앨지(ML·서버 담당).
- [ ] 브랜치: `lee_app1`(FE 커밋 7개, `develop`에 없음)과 `feature/repo-backend-db-v2`를 `develop`에 넣는 순서.
  둘 다 `model/prototype/pose.ts`·`frontend/src/features/session/server/validation.ts`를 고쳐 충돌한다.

### 1단계 — 서버와 무관한 준비 (지금 시작 가능)

- [ ] **규칙 문서와 합성 시험 데이터 작성.** 앱 판정을 지우기 전에 한다. 판정 가능, 특징값, 점수, 고개 돌림 0.15, 복귀 대기 3초/1초를
  좌표 → 기대 결과 쌍으로 만든다. 근거: `model/prototype/pose.ts`, `frontend/src/lib/returnSettle.ts`, [세션 내보내기 명세](../../research/session-export.md).
- [ ] **ADR 작성: "앱은 판정하지 않는다".** [데이터 플랫폼 경계](../../design/data-platform-boundary.md)의 "좌표 미전송"과
  [실시간 계약](../../../contracts/realtime/README.md)의 "좌표를 넣지 않는다"를 함께 고친다(0단계 결과 반영).

### 2단계 — 앱 판정 제거

- [ ] ML용 CSV 판정 라벨(state·type·score) 제거: `poseDebugExport.ts`, `kafkaExport.ts`, 세션 내보내기 명세.
- [ ] 유형 표시 제거: `ServerDecisionHistory.tsx`, `server/projection.ts`, 기록 상세.
- [ ] 로컬 모드 제거: `LocalServiceApp.tsx`, `LocalHistory.tsx`, `storage/localRepository.ts`·`useLocalWorkspace.ts`, `session/engine/`, `lib/engine.ts`,
  `lib/returnSettle.ts`, `lib/postureScore.ts`와 이를 쓰는 화면. 시연용 예시 기록이 로컬 저장에 기대는지 확인한다.
- [ ] 측정 화면의 점수·상태를 서버 결과 표시로 바꾼다. 서버 없이는 측정을 시작하지 않는다.
- [ ] 라벨 촬영 수집 화면: BE·ML 요구가 올 때까지 판정 라벨만 빼고 둔다.

### 3단계 — 서버 연결 (0단계 결정 후)

- [ ] 기준 자세: 보정 3초 동안 좌표 9개 x·y 평균 18개 전송(`feature/repo-backend-db-v2`의 `setup.baseline.landmarks`와 맞춘다).
- [ ] 정보 전송: 0.5초 묶음, 순번·`ack` 재전송·재연결, `phase`(`running`·`calibration`·`rest`·`away`). 카메라 1.5초 이상 끊기면 `away`, 일시정지는 `rest`.
- [ ] 화면 구동: `observation`·`progress`·`decision`·`alert`. `excluded_started/ended`는 받기만 한다. 연결 끊김 표시.
- [ ] 기록 화면: 서버가 세션 테이블로 다시 만든 기록을 그대로 쓴다(`client_record` 없음).

### 4단계 — 동의

- [ ] 가입 동의문에 좌표 전송·학술용 적재를 넣고 새 버전(예: `service-v2`)으로 바꾼다. 서버 검증값도 함께 바꾼다.
- [ ] 동의 저장 위치(`user_consent` 보류 해제)를 DB에 요청한다. 설정의 철회 토글, 측정 준비 화면의 "좌표 전송 안 함" 문구를 고친다.

### 5단계 — 검증과 정리

- [ ] 실패 경로 시험: 서버 없음, 연결 끊김·재연결, 중복·역순 순번, 로그인 만료.
- [ ] `make check`, 서버 담당과 연동 시험(T-13).
- [ ] 문서 갱신: [문서 지도](../../index.md), `frontend/README.md`, [0022 계획](0022-kafka-realtime-pipeline.md)의 "로컬 판정과 선택 공존" 정리.

## 결정과 진행 기록

- 2026-10-11: 앱 판정·라벨 전부 제거, 서버 전용 앱으로 결정. 네트워크 끊김 때 로컬 미리보기는 하지 않는다(앱 판정이 없으므로).
  소리 설정은 저장하지 않는다. 화면 크기는 팀 카메라 전제로 640×480 요청을 유지한다. 좌표 프레임 계약 이름은 `posture.frames.v1`.
- 남은 질문: 0단계 전체. 라벨 촬영 수집 화면의 새 요구(BE·ML).

## 검증 결과와 남은 한계

- 계획만 작성했다. 코드는 바꾸지 않았고 검증을 실행하지 않았다.
