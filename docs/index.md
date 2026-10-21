# 문서 지도

## 현재 상태와 작업

[정면 어깨 위의 판정 한계](ml/measurement-limits.md)부터 확인한다. [ML 재설계](ml/rebuild-plan.md) · [실행 계획 0052](plans/active/0052-ml-rebuild.md)는 서비스 FE·BE를 유지하며, 지원 현상·구도·라벨이 성립한 뒤 진행할 조건부 계획이다. 본 수집과 LSTM 구현은 보류하며 아래 `/dev` 실행 동작은 아직 바뀌지 않았다.

[jisung·백엔드 로컬 병합 기록](plans/completed/0031-jisung-backend-integration.md): 연구 기능 보존, 프론트·Python 검증 결과와 JDK/MySQL/실시간 연동의 남은 한계.

[정면 2D·상대 z 관측 비교](ml/jisung/2026-10-16-mac-observation-comparison.md): `/dev?view=observation`에서
네 동작을 이동 2초·유지 5초·기준 복귀 5초씩 3바퀴 안내한다. 영상 위 모서리 안내와 단계명·남은 초가 든 두꺼운 게이지를 보며 수행한다. 고정 기준 대비 변화·추이·수동 비교표를
확인하고 바퀴·단계·재시도를 구분한 파생 시계열을 클릭하여 CSV로 내려받는다.
자동 판정·자동 저장·학습은 하지 않는다.

[최신 ML 계획](ml/current-plan.md) · [HTML로 보기](ml/current-plan.html): 정상 자료로 등록 검증·중심 고정, 자동 6% 기본 선택과 LSTM 보조 비교.
[큰 몸 변화 보완](decisions/0034-fixed-image-posture-anchor.md): 등록 영상의 위치·어깨폭에 고정한 별도 점수로 정규화가 놓치는 큰 이동·축소를 확인한다. 작은 움직임 허용과 무음 기본값을 유지하며 실제 기대기 정확도는 미검증이다.
[현재 허용폭·자동 정상 선별](decisions/0035-posture-and-clean-normal-selection.md): 영상 v2 이동 18%·축소 12%, 자동 후보 종합 0.5배·1초 유지와 이전 자료 재검토 차단.
[현재 종합 이탈 경계](decisions/0036-composite-entry-point-seven.md): 사용자 지정 0.7배 연속 진입과 약0.47배 복귀, 실제 관찰에서 찾은 진입 타이머 보완.
[얼굴 전용 추적·공개 학습 자료](ml/face-and-public-data.md): /dev Face Worker와 안경 조건별 동일 영상 비교, 기존 Panoptic/MultiPosture 학습과 새 자료 적용 경계.
[MediaPipe 학습 안내](ml/mediapipe-training.md) · [ADR 0032](decisions/0032-normal-reference-and-mediapipe-training.md): 수집 JSON→분할 검사→로컬 학습→모델 불러오기. 합성 연결 검증과 실제 참여자 성능을 구분한다.
[실제 카메라 성능](ml/camera-performance.md) · [촬영과 ML 공백 감사](ml/live-keypoint-audit.md): GPU·모델 비교와 실제 움직임 관찰을 구분한다.

현재 우선순위는 로컬 측정·개인 기준 특징이다. 서버/Kafka 확장은 후순위다.
[개발자 실험실 `/dev`](design/developer-lab.md): 큰 카메라·구도 가이드·자동 등록, 모델/룰 비교와 합성 데모.
서비스 승격과 의존성은 [개발 모듈 안내](../frontend/src/features/developer/README.md)에서 분리해 관리한다.
[개발 실행 경계](decisions/0024-local-development-server-boundary.md): 로컬에서 먼저 검증하고 동일 의미의 입력·결과로 서버에 연결한다. 새 전송 계약과 런타임은 후속 구현이다.
[기준 등록 자료 보존](decisions/0022-local-baseline-archive.md): 완료된 13점 기준 시계열을 로컬에 모으며 라벨은 개발상의 정상 가정이다.

웹캠 단일 앱, MySQL 이메일·비밀번호 계정, DB V2.3 저장과 API 안의 판정 엔진([ADR 0020](decisions/0020-single-api-decision-engine.md)), Compose·배포 자동화 설정의 코드가 있다.
현재 DB 스키마와 백엔드의 대응 여부는 [DB 안내](../database/README.md)를 확인한다.
프론트의 계정·세션 API v2 연결과 좌표 WebSocket v2 전환은 아직 구현 전이다. 로컬 `/dev`·`#forecast`의 LSTM 비교와 일반 서비스 연결을 구분한다.
실제 참여자에 대한 모델 정확도·연구 효과·운영 배포 완료는 이 상태 설명에 포함되지 않는다.

- [개인 기준 특징 최종 점검표](research/personal-baseline-final-review.md): 유지할 결정·필수 보완·다음 비교. [설계 상세](research/personal-baseline-feature-design.md), [비교 결정](decisions/0023-baseline-feature-comparison.md).
- [ML / jisung 환경별 기록](ml/jisung/README.md): desktop·home 기록을 구분한 결정·구현 상태·테스트 브랜치 비교·인계.
- [팀 서비스 요구사항](removed-docs.md): 기능·역할·수용 기준·협의 항목.
- [실시간 연동 명세](design/api-ws-spec.md)·[WebSocket v2 계약](../contracts/realtime/realtime-ws.v2.schema.json): 좌표 전송·측정 불가·구도/멈춤 표시의 목표 경로. 이전 Kafka 계획과 화면 문서는 [지운 문서 기록](removed-docs.md)에 남겼다.
- [백엔드 재작성](plans/active/0026-backend-v2-rebuild.md)·[DB V2.3 연동 결정](decisions/0022-db-v23-feature-v2-integration.md): 단일 API와 현재 DB 대응. [서비스 DB 전환(V1.1)](removed-docs.md)은 이전 계획이다.
- [프론트–API v2 연결](plans/active/0027-frontend-backend-v2-connection.md): 되돌린 프론트를 계정·기준 자세·세션 v2와 DB V2.3에 다시 잇는 수정 목록.
- [백엔드 Java 17·Spring Boot 4·Gradle 전환](plans/active/0028-backend-java17-boot4-gradle.md)([ADR 0023](decisions/0023-backend-java17-boot4-gradle.md)): 백엔드·개발 도구 변경과 Docker·CI 팀원 작업 요청.
- [데스크톱 화면 계획](plans/active/0020-desktop-app-redesign.md): [화면 설계](design/desktop-app.md), [연동 명세](design/api-ws-spec.md), [시각 규칙](../DESIGN.md).
- [현재 환경 인계와 과거 검증](development-handoff.md). main/develop 직접 push 금지.

## FE 현재 결정과 작업 (2026-10-14, `feature/frontend-features-and-integration`)

- **결정:** [ADR 0021 앱은 정보만 보내고 판정은 서버가 한다](decisions/0021-app-sends-information-server-judges.md), [ADR 0024 서버 연결이 끊기면 세션을 끝낸다](decisions/0024-session-ends-on-lost-connection.md).
- **연동 명세:** [앱 ↔ 입출구 서버 연동 명세](design/api-ws-spec.md) — BE API 명세(10/13)와 같은 ID·경로. 로그인·설정·기록은 REST, 실시간 판정·자세 등록은 WebSocket `/v2/realtime`. BE에 확인할 것은 0장.
- **계약:** [WebSocket v2](../contracts/realtime/realtime-ws.v2.schema.json)·[합성 예시](../contracts/realtime/examples-v2/), [좌표 구간](../contracts/realtime/frames/posture-frames.v1.schema.json).
- **FE 제안서:** [서버 판정 이전과 연동](design/fe-server-proposal.md) — 1장 남은 질문(없음, 실시간 v2 확정 10/15)·BE 진행 중인 것, 2장 전제·결정, 3장 앱이 보내는 것, 7장 FE 할 일.
- **동의:** [개인정보 수집 동의](design/consent-proposal.md) — 회원가입 3단계(약관 동의 C1~C6 → 계정 정보 → 자세 등록 선택), 보유 기간 탈퇴 후 30일.
- **10/12~14 결정 요약:** 가입·프로필 입력은 서버와 같게 이름 1~30자(FE·BE·DB 모두), 나이 14~120, 비밀번호 72바이트는 앱이 검사하고 12자 검사는 서버를 붙일 때 켠다(10/14). 판정 불가는 측정이 안 되는 모든 경우를 넓게 하나로(앱이 `valid:false`, DB `UNMEASURABLE`). 통계는 서버가 계산하고 앱은 표시만. 오늘 측정은 끝났을 때 그 세션만 결과에 보이고, 기록 목록에는 오늘 세션도 보이되 통계는 어제까지(10/14). 카메라는 640×480 고정(팀 결정). 5분 미만 세션도 저장하고 "붕괴까지 걸린 시간" 통계에서만 뺀다(DB V2.3, 10/14 정정). 기록·달력 화면은 lellon0403 담당(10/14 개편). 계정 서버 연결(F12)은 BE 담당(10/14).
- **10/15 정리:** BE와 이름이 다르면 BE에 맞춘다(적재된 기록 삭제 거부는 409 `CONFLICT`). 배치 번호는 아키텍처 v5.2(J1 적재, J2 집계 00:00, J3 탈퇴 삭제 04:00). DB 저장 이름·단위는 [연동 명세](design/api-ws-spec.md) 1장. 실시간은 `/v2/realtime`으로 확정(BE 답). BE 브랜치의 v1은 서버를 먼저 돌려 보려고 섞인 임시 상태다.
- **실행 계획:** [앱 판정 제거와 서버 결과 전용 화면](plans/active/0023-frontend-server-only.md)(0023).
- **BE·FE 통합의 남은 차이:** [BE·DB·DevOps 통합 브랜치 계획](plans/active/0029-merge-backend-data-platform.md)(0029)에 v1 구현과 v2 목표 계약의 차이를 기록했다. 병합만으로 API·WS 연동이 완료되지는 않는다.
- **`make check` 실패 이력:** [원인과 고칠 것](plans/active/0030-make-check-failures.md)(0030, Maven과 무관). Gradle 전환 코드는 포함되어 있으며 이 계획의 과거 결과와 현재 검증 결과를 구분한다.
- **명령과 검사:** [FE 작업 명령과 검사](design/fe-commands-and-checks.md), 설치할 프로그램 [requirements-front.txt](../requirements-front.txt).
- **수집:** 자세 데이터 수집 CSV는 [v3](research/guided-collection-v2.md). 측정 결과 내보내기는 [session-export](research/session-export.md).
- **용어:** 서비스 앱의 「라벨」은 서버·ML이 만드는 판정·학습 정답을 뜻한다. 서비스 수집 화면의 참여자 선택은 「자기 보고 확인」이다. `/dev` 초기 실험의 규칙 기반 자동 임시 라벨은 [ADR 0029](decisions/0029-automatic-normal-labels-and-forecast-display.md)의 별도 예외이며 평가 정답이 아니다.
- **지운 문서:** 끝났거나 다른 문서와 겹친 문서는 지우고 [지운 문서 기록](removed-docs.md)에 이유·간 곳·되살리는 법을 남겼다. 지운 문서를 가리키던 링크는 그 기록으로 바꿨다.

## 질문별 진입점

| 질문 | 기준 문서 |
| --- | --- |
| 무엇을 만드는가? | [제품 범위](product-spec.md), [원래 자료와 출처](references/README.md) |
| 어디에 구현하는가? | [아키텍처](architecture.md), [코드 지도](code-structure.md) |
| 어떻게 작업·실행하는가? | [AGENTS](../AGENTS.md), [개발 흐름](development.md), [프론트](../frontend/README.md), [백엔드](../backend/README.md) |
| 브랜치·커밋 이름은? | [Git 명명 규칙](../CONTRIBUTING.md) |
| 무엇을 검증하는가? | [품질 기준](quality.md) |
| 데이터와 API의 경계는? | [계약](../contracts/README.md), [DB](../database/README.md), [플랫폼 책임](design/data-platform-boundary.md) |
| 어떻게 배포·복원하는가? | [infra](../infra/README.md) |
| 연구 분할·학습은? | [프로토콜](research/protocol.md), [자료 준비](research/dataset-preparation.md), [개인 실험](research/personal-pilot-training.md) |
| 수집은? | [Heavy 수집 v3](research/guided-collection-v2.md), [파일럿 CSV](research/pilot-csv.md), [수집 진입 결정](decisions/0016-collection-entry-and-camera-preview-window.md) |
| 시간·특징 정책은? | [시간 정책](decisions/0012-session-timing-policy.md), [서버 특징](decisions/0013-frontend-server-feature-connection.md), [어깨 척도](decisions/0019-shoulder-tilt-scale.md) |
| 왜 이렇게 결정했는가? | [결정 이력](decisions/), [지운 문서 기록](removed-docs.md) |
| 현재·다음 작업은? | [활성 계획](plans/active/), [백로그](plans/backlog.md), [계획 양식](plans/template.md) |

## 이력과 근거

[완료 계획](plans/completed/)에는 구현 범위와 당시 검증을, [감사 기록](removed-docs.md)에는 시점별 결과·한계를 남긴다.
최근 개인 파일럿은 [완료 0019](removed-docs.md), 카메라 창은 [완료 0018](removed-docs.md),
계정·Compose는 [완료 0017](removed-docs.md)을 참고한다.
[현재 DB V2.3 연동 결정](decisions/0022-db-v23-feature-v2-integration.md)을 우선 참고한다.
과거 백엔드 V2(DB V2.2) 구현 범위·남은 일·문제는 [2026-10-10 현황](audits/2026-10-10-backend-v2-status.md)에 있다.
[Mac 통합 점검](removed-docs.md), [lee 브랜치 기록](removed-docs.md), [페르소나 메모](removed-docs.md)는 해당 시점의 참고다.
과거 계획서의 스택·수치와 과거 작업 승인은 현재 작업의 의무나 권한으로 취급하지 않는다.

## 문서의 권위와 유지

사용자의 현재 요청을 기준으로 작업한다. 제품 범위·아키텍처·계약·연구 프로토콜은 각각 자신의 사실과 기준을 관리한다.
행동 변경은 관련 문서와 예제를 함께 갱신하고 중요한 결정은 ADR에 남긴다.
제공 원문은 수정하지 않으며 외부 문헌의 수치·주장은 검토 전까지 검증된 사실로 인용하지 않는다.
