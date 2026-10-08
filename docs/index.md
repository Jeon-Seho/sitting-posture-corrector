# 문서 지도

## 현재 상태와 작업

웹캠 단일 앱, MySQL 이메일·비밀번호 계정, 영구 저장·API/CEP 복구, Compose·배포 자동화 설정의 코드가 있다.
현재 DB 스키마와 백엔드의 대응 여부는 [DB 안내](../database/README.md)를 확인한다.
학습된 LSTM 연결·실제 장치 품질/연구 효과·운영 배포 완료는 이 상태 설명에 포함되지 않는다.

- [팀 서비스 요구사항](team-requirements.md): 기능·역할·수용 기준·협의 항목.
- [실시간 경로 계획](plans/active/0022-kafka-realtime-pipeline.md): 팀·ML 확인 대기. [측정 불가](design/unmeasurable-handling.md), [구도와 멈춤 화면](design/setup-framing-and-pause-display.md).
- [서비스 DB 전환](plans/active/0021-db-schema-v03-alignment.md): API 구현과 현재 스키마의 대응 상태는 [DB 안내](../database/README.md)에서 확인한다.
- [데스크톱 화면 계획](plans/active/0020-desktop-app-redesign.md): [화면 설계](design/desktop-app.md), [연결 지점](design/frontend-platform-seams.md), [시각 규칙](../DESIGN.md).
- [현재 환경 인계와 과거 검증](development-handoff.md). main/develop 직접 push 금지.

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
| 수집은? | [Lite 수집 v2](research/guided-collection-v2.md), [파일럿 CSV](research/pilot-csv.md), [수집 진입 결정](decisions/0016-collection-entry-and-camera-preview-window.md) |
| 시간·특징 정책은? | [시간 정책](decisions/0012-session-timing-policy.md), [서버 특징](decisions/0013-frontend-server-feature-connection.md), [어깨 척도](decisions/0019-shoulder-tilt-scale.md) |
| 왜 이렇게 결정했는가? | [결정 이력](decisions/), [기술 검토](audits/2026-10-01-technology-stack.md) |
| 현재·다음 작업은? | [활성 계획](plans/active/), [백로그](plans/backlog.md), [계획 양식](plans/template.md) |

## 이력과 근거

[완료 계획](plans/completed/)에는 구현 범위와 당시 검증을, [감사 기록](audits/)에는 시점별 결과·한계를 남긴다.
최근 개인 파일럿은 [완료 0019](plans/completed/0019-personal-pilot-training.md), 카메라 창은 [완료 0018](plans/completed/0018-collection-entry-camera-window.md),
계정·Compose는 [완료 0017](plans/completed/0017-mysql-accounts-compose-deployment.md)을 참고한다.
[Mac 통합 점검](audits/2026-09-30-mac-develop.md), [lee 브랜치 기록](lee_md.md), [페르소나 메모](persona-flow-review.md)는 해당 시점의 참고다.
과거 계획서의 스택·수치와 과거 작업 승인은 현재 작업의 의무나 권한으로 취급하지 않는다.

## 문서의 권위와 유지

사용자의 현재 요청을 기준으로 작업한다. 제품 범위·아키텍처·계약·연구 프로토콜은 각각 자신의 사실과 기준을 관리한다.
행동 변경은 관련 문서와 예제를 함께 갱신하고 중요한 결정은 ADR에 남긴다.
제공 원문은 수정하지 않으며 외부 문헌의 수치·주장은 검토 전까지 검증된 사실로 인용하지 않는다.
