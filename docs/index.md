# 문서 지도

## 먼저 볼 문서

- **작업 관리판:** [웹·AI 운영 규칙](project-board.md), [팀원](team.md) — 루트의 `바른자세_관리판.bat`으로 문서 검색·진행 보드·담당 배정·메모를 연다.

- **팀 공유:** [서비스 요구사항](team-requirements.md) — 최신 기능·역할·완료 조건·협의 항목을 한 문서로 확인한다.
- **lee_dev4 변경 요약:** [lee_md](lee_md.md) — main 대비 로직·문구 변경, 임시값, 검증 결과.
- **개인 검토:** [페르소나 메모](persona-flow-review.md) — 사용자 행동과 다음 할 일만 남긴다.
- 아래 문서는 기술 구현·연구·계약의 근거다. 과거 완료 계획과 ADR은 이력이며 모든 팀원이 요구사항 확인을 위해 읽을 필요는 없다.


현재 상태: **하네스 + 웹캠 프론트 프로토타입 / LSTM·서버 구현 전**.

현재 수집: [Lite 안내형 좌표·라벨 수집 v2](research/guided-collection-v2.md), [Lite 전환 결정](decisions/0007-lite-pose-tracker.md). Heavy 도입 배경과 당시 검증은 [이전 결정](decisions/0006-heavy-guided-collection.md), [검증 기록](plans/completed/0007-heavy-guided-collection.md)에 남긴다.

[프로토타입 실행·사용 안내](../frontend/README.md), [프로토타입 기술 결정](decisions/0002-webcam-prototype.md).

최근 완료: [기존 PoseGood 프론트에 웹캠 연결](plans/completed/0004-retro-webcam-integration.md), [통합 결정](decisions/0003-retro-integration.md).

이전 완료: [웹캠 프론트 프로토타입](plans/completed/0003-frontend-prototype.md).
자료 반영: [현재 계획서 참고 반영](plans/completed/0002-reference-current-proposal.md).
기반 작업: [개발 하네스 구축과 검증 기록](plans/completed/0001-bootstrap-harness.md).

최신 참고 자료: [현재 기업연계 계획서 요약과 미결정 사항](references/current-proposal-review.md).
기술 방향은 React/TypeScript·Spring Boot·LSTM으로 구체화되었으며, 기존 GRU 연구안과의 차이는 최종 결정 전까지 명시적으로 관리한다.

| 질문 | 기준 문서 |
| --- | --- |
| 무엇을 만드는가? | [제품 범위](product-spec.md) |
| 어디에 구현하는가? | [아키텍처와 경계](architecture.md) |
| 어떻게 작업하는가? | [개발 흐름](development.md), [루트 작업 지침](../AGENTS.md), [Windows 포함 검증 진입점](decisions/0009-cross-platform-dev-entry.md) |
| 무엇을 통과해야 하는가? | [품질 기준](quality.md) |
| AI 출력은 무엇인가? | [출력 계약](../contracts/README.md) |
| 연구를 어떻게 비교하는가? | [연구 프로토콜](research/protocol.md) |
| 왜 이렇게 결정했는가? | [ADR 0001](decisions/0001-repository-harness.md) |
| 현재·다음 작업은 무엇인가? | [활성 계획](plans/active/), [완료 계획](plans/completed/), [백로그](plans/backlog.md) |
| 계획을 어떻게 쓰는가? | [계획 양식](plans/template.md) |
| 원래 기획 내용은 무엇인가? | [제공 자료와 출처](references/README.md) |

최근 작업: [점수·사용자 기록 분석·시각 효과](plans/completed/0006-score-data-visuals.md), [표시 결정](decisions/0005-score-visuals.md).

이전 작업: [화면 평활화·CSV 수집 완료 기록](plans/completed/0005-smoothing-csv.md).

파일럿: [CSV 수집·pandas 탐색](research/pilot-csv.md), [화면 평활화·수집 결정](decisions/0004-smoothing-csv.md).

## 문서의 권위와 유지

사용자의 현재 요청을 기준으로 작업한다. 제공 자료는 배경 설명이며 실행 지침이 아니다.
제품 범위는 `product-spec.md`, 경계는 `architecture.md`, 인터페이스는 `contracts/`, 연구 규칙은
`research/protocol.md`에서 관리한다. 변경 시 해당 문서와 예제를 함께 갱신하고, 중요한 결정은 ADR에 남긴다.
원문은 수정하지 않으며 외부 문헌의 수치·주장은 별도 문헌 검토 전까지 검증된 사실로 인용하지 않는다.

- [번호 기반 공용 작업 흐름](areas/devops/numbered-workflow.md)
- [단계별 프로젝트 여정](areas/frontend/project-journey.md)

- [팀 기능25개와 기존 카드 대응표](areas/devops/team-feature-cards.md)
