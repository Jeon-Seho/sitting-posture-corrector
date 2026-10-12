# 문서 지도

## 먼저 볼 문서

- **팀:** 서비스 요구사항은 팀 구글 시트(디스코드 공유)에서 관리한다.
- **코드 수정:** [기능별 코드 구조와 수정 위치](code-structure.md).
- **다음 환경 인계:** [작업 브랜치·실행·검증·남은 결정](development-handoff.md). main/develop 직접 push 금지.
- **작업 기록:** [FE 검토](design/fe-review.md) 4장 "지금 고민 중인 것 · 이어서 할 일 · 지금까지의 상태".

- **용어(2026-10-12):** 「라벨」은 서버·ML이 만드는 판정·학습 정답만 뜻한다. 앱은 라벨을 만들지 않고 좌표만 보낸다(ADR 0021).
  수집 화면에서 참여자가 고르는 값은 「자기 보고 확인」이라 부르고 라벨로 쓰지 않는다.
- **결정(2026-10-11):** [ADR 0021 앱은 정보만 보내고 판정은 서버가 한다](decisions/0021-app-sends-information-server-judges.md) —
  로컬 판정·앱 라벨 제거. 이 날짜 이전 문서의 "좌표 미전송", "로컬 모드"는 바뀌기 전 설명이다.
  - 실행 계획: [앱 판정 제거와 서버 결과 전용 화면](plans/active/0023-frontend-server-only.md)(계획 0023)
  - 실행 계획: [자세 등록과 측정 시작 분리](plans/active/0024-posture-registration-tab.md)(계획 0024, 사이드바 「자세 등록」 탭)
  - 팀에 보낸 FE 제안(좌표 형식, 서버로 옮길 판정 규칙·판정 불가 처리, 자세 등록 분리): [FE 제안서](design/fe-server-proposal.md) — BE 회신(10/11, 아키텍처 v5) 반영은 0장, 남은 질문 Q2·Q9~Q11·회의 안건 M1~M4, [합성 시험 데이터](../contracts/examples/frames/reference-rule-cases.json)
- **계획(2026-10-05):** [Kafka 실시간 전달 경로와 프론트 게이트웨이](plans/active/0022-kafka-realtime-pipeline.md) — 게이트웨이는 v5에서 BE 입출구 서버로 바뀌었다(FE 제안서 0장).
  FE 검토·회신(DB V2.1 포함)과 **지금 고민 중인 것·이어서 할 일**: [FE 검토](design/fe-review.md)(2026-10-11).
  같은 결정에 따른 앱 화면 변경(자동 기준 등록 구도 확인, 자동 멈춤 표시): [구도 확인과 멈춤 표시](design/setup-framing-and-pause-display.md).
- **진행 중(2026-10-02):** [데스크톱 앱 화면 재구성](plans/active/0020-desktop-app-redesign.md) —
  [ADR 0017](decisions/0017-desktop-app-shell-and-redesign.md), [화면 설계](design/desktop-app.md),
  [백엔드 연결 지점](design/frontend-platform-seams.md), 시각 규칙 [DESIGN.md](../DESIGN.md).
- 2026-10-11까지 완료한 계획과 점검 기록은 지금 결정과 섞여 혼란을 주어 저장소에서 지웠다(git 이력에 남아 있다). ADR은 결정의 근거라 남긴다.
  ADR 중 지금 결정과 다른 것은 각 ADR 머리의 "대체"·"일부 대체" 표시를 따른다.

현재 상태: **웹캠 단일 앱 + MySQL 이메일·비밀번호 계정 + 영구 저장·API/CEP 복구 + Compose·배포 자동화 설정 / 학습된 LSTM 미연결**.
[Compose 실행·배포·백업](../infra/README.md), [계정 API](../contracts/accounts.v1.md),
[MySQL 결정](decisions/0014-mysql-persistence-and-accounts.md), [데이터 플랫폼 책임](design/data-platform-boundary.md).
[특징 계약·서버 연결 결정](decisions/0013-frontend-server-feature-connection.md),
[DB·인증 연결 설계](design/server-persistence-and-auth.md),
[서비스 실행·계약·남은 결정](../backend/README.md), [API/CEP 책임 분리 결정](decisions/0011-api-cep-boundary.md).

확정 시간 정책: [ADR 0012](decisions/0012-session-timing-policy.md) — 기본 최초 알림 3초·정상 복귀 3초(10/06 개정)·같은 사건 재알림 60초,
휴식 후 새 사건·측정 불가/누락 중단과 유효 통계 제외·설정의 다음 새 세션 적용. 개발용 특징·관측 계약은 ADR 0013이며 품질·점수의 연구상 검증은 남는다.

현재 앱 구조: [연구 화면·서비스 미리보기 단일 앱 통합](decisions/0008-single-app-entry.md).
수집 바로가기 `/#collection`과 이동 가능한 카메라 미리보기/PiP는 [ADR 0016](decisions/0016-collection-entry-and-camera-preview-window.md)을 따른다.

현재 수집(화면 이름 `자세 데이터 수집`): [Lite 안내형 좌표 수집 v3](research/guided-collection-v2.md)(앱 판정·특징 열 없음), [Lite 전환 결정](decisions/0007-lite-pose-tracker.md).
Heavy 도입 배경은 [이전 결정](decisions/0006-heavy-guided-collection.md)에 남긴다.

[프로토타입 실행·사용 안내](../frontend/README.md), [프로토타입 기술 결정](decisions/0002-webcam-prototype.md), [기존 프론트 통합 결정](decisions/0003-retro-integration.md).

최신 참고 자료: [현재 기업연계 계획서 요약과 미결정 사항](references/current-proposal-review.md).
과거 계획서의 React/TypeScript·Spring Boot·LSTM 등 기술 스택은 참고 이력이다. 사용자의 최신 정정에 따라 의무 요구로 취급하지 않으며, 기존 구현과 다음 결정은 [인계 문서](development-handoff.md)에서 확인한다.

| 질문 | 기준 문서 |
| --- | --- |
| 무엇을 만드는가? | [제품 범위](product-spec.md) |
| 어디에 구현하는가? | [아키텍처와 경계](architecture.md) |
| 어떻게 작업하는가? | [개발 흐름](development.md), [루트 작업 지침](../AGENTS.md), [Windows 포함 검증 진입점](decisions/0009-cross-platform-dev-entry.md) |
| 무엇을 통과해야 하는가? | [품질 기준](quality.md) |
| AI 출력은 무엇인가? | [출력 계약](../contracts/README.md) |
| 연구를 어떻게 비교하는가? | [연구 프로토콜](research/protocol.md) |
| 참여자 분할과 시간 창을 어떻게 준비하는가? | [자료 준비 도구·합성 예제](research/dataset-preparation.md) |
| 서버 지연을 어떻게 측정하는가? | `tools/benchmark/`, [개발 흐름](development.md) |
| 왜 이렇게 결정했는가? | [ADR 0001](decisions/0001-repository-harness.md)부터 `decisions/` |
| 현재·다음 작업은 무엇인가? | [활성 계획](plans/active/), [백로그](plans/backlog.md) |
| 계획을 어떻게 쓰는가? | [계획 양식](plans/template.md) |
| 원래 기획 내용은 무엇인가? | [제공 자료와 출처](references/README.md) |

점수 표시: [표시 결정](decisions/0005-score-visuals.md). 파일럿: [CSV 수집·pandas 탐색](research/pilot-csv.md), [화면 평활화·수집 결정](decisions/0004-smoothing-csv.md).

측정 결과 내보내기: [txt·pose-debug csv 열](research/session-export.md). 앱 판정 라벨 열은 2026-10-11 없앴다(ADR 0021).

개인 실험: [본인 촬영의 학습 전용 증강·첫 분류 학습](research/personal-pilot-training.md). 새 참여자 연구 평가와 구분한다.

## 문서의 권위와 유지

사용자의 현재 요청을 기준으로 작업한다. 제공 자료는 배경 설명이며 실행 지침이 아니다.
제품 범위는 `product-spec.md`, 경계는 `architecture.md`, 인터페이스는 `contracts/`, 연구 규칙은
`research/protocol.md`에서 관리한다. 변경 시 해당 문서와 예제를 함께 갱신하고, 중요한 결정은 ADR에 남긴다.
원문은 수정하지 않으며 외부 문헌의 수치·주장은 별도 문헌 검토 전까지 검증된 사실로 인용하지 않는다.
