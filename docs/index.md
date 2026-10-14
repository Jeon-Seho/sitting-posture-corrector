# 문서 지도

## 현재 상태와 작업

웹캠 단일 앱이다. 앱은 관절 좌표를 보내고 판정은 서버가 한다(아키텍처 v5.1, 입출구 서버는 BE가 만든다).
입출구 서버가 생기기 전이라 지금 앱은 이 기기에서 로그인·회원가입·기록을 다룬다(2026-10-13 예전 계정 모드 삭제).
현재 DB 스키마(V2.3)와 백엔드의 대응은 [DB 안내](../database/README.md)를 확인한다.
학습된 LSTM 연결·실제 장치 품질/연구 효과·운영 배포 완료는 이 상태 설명에 포함되지 않는다.

- [데스크톱 화면 계획](plans/active/0020-desktop-app-redesign.md): [화면 설계](design/desktop-app.md), [시각 규칙](../DESIGN.md).
- [현재 환경 인계와 과거 검증](development-handoff.md). main/develop 직접 push 금지.

## FE 현재 결정과 작업 (2026-10-13, `lee_app3`)

- **결정:** [ADR 0021 앱은 정보만 보내고 판정은 서버가 한다](decisions/0021-app-sends-information-server-judges.md), [ADR 0022 서버 연결이 끊기면 세션을 끝낸다](decisions/0022-session-ends-on-lost-connection.md).
- **연동 명세:** [앱 ↔ 입출구 서버 연동 명세](design/api-ws-spec.md) — BE API 명세(10/13)와 같은 ID·경로. 로그인·설정·기록은 REST, 실시간 판정·자세 등록은 WebSocket `/v2/realtime`. BE에 확인할 것은 0장.
- **계약:** [WebSocket v2](../contracts/realtime/realtime-ws.v2.schema.json)·[합성 예시](../contracts/realtime/examples-v2/), [좌표 구간](../contracts/realtime/frames/posture-frames.v1.schema.json).
- **FE 제안서:** [서버 판정 이전과 연동](design/fe-server-proposal.md) — 1장 남은 질문(지금 없음), 2장 전제·결정, 3장 앱이 보내는 것, 7장 FE 할 일.
- **동의:** [개인정보 수집 동의](design/consent-proposal.md) — 회원가입 3단계(약관 동의 C1~C6 → 계정 정보 → 자세 등록 선택), 보유 기간 탈퇴 후 30일.
- **10/12~13 결정 요약:** 판정 불가는 측정이 안 되는 모든 경우를 넓게 하나로(앱이 `valid:false`, DB `UNMEASURABLE`). 통계는 서버가 계산하고 앱은 표시만. 오늘 측정은 끝났을 때 그 세션만 결과에 보이고, 기록 목록에는 오늘 세션도 보이되 통계는 어제까지(10/14). 카메라는 640×480 고정(팀 결정). 5분 미만 세션도 저장하고 "붕괴까지 걸린 시간" 통계에서만 뺀다(DB V2.3, 10/14 정정). 기록·달력 화면은 lellon0403 담당(10/14 개편).
- **실행 계획:** [앱 판정 제거와 서버 결과 전용 화면](plans/active/0023-frontend-server-only.md)(0023).
- **명령과 검사:** [FE 작업 명령과 검사](design/fe-commands-and-checks.md), 설치할 프로그램 [requirements-front.txt](../requirements-front.txt).
- **수집:** 자세 데이터 수집 CSV는 [v3](research/guided-collection-v2.md). 측정 결과 내보내기는 [session-export](research/session-export.md).
- **용어:** 「라벨」은 서버·ML이 만드는 판정·학습 정답만 뜻한다. 앱은 라벨을 만들지 않는다.
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
| 수집은? | [Lite 수집 v2](research/guided-collection-v2.md), [파일럿 CSV](research/pilot-csv.md), [수집 진입 결정](decisions/0016-collection-entry-and-camera-preview-window.md) |
| 시간·특징 정책은? | [시간 정책](decisions/0012-session-timing-policy.md), [서버 특징](decisions/0013-frontend-server-feature-connection.md), [어깨 척도](decisions/0019-shoulder-tilt-scale.md) |
| 왜 이렇게 결정했는가? | [결정 이력](decisions/), [지운 문서 기록](removed-docs.md) |
| 현재·다음 작업은? | [활성 계획](plans/active/), [백로그](plans/backlog.md), [계획 양식](plans/template.md) |

## 이력과 근거

끝난 계획은 지우는 것이 규칙이다. 지운 완료 계획·점검 기록·개인 기록은 [지운 문서 기록](removed-docs.md)에서 찾아 git 이력으로 읽는다.
과거 계획서의 스택·수치와 과거 작업 승인은 현재 작업의 의무나 권한으로 취급하지 않는다.

## 문서의 권위와 유지

사용자의 현재 요청을 기준으로 작업한다. 제품 범위·아키텍처·계약·연구 프로토콜은 각각 자신의 사실과 기준을 관리한다.
행동 변경은 관련 문서와 예제를 함께 갱신하고 중요한 결정은 ADR에 남긴다.
제공 원문은 수정하지 않으며 외부 문헌의 수치·주장은 검토 전까지 검증된 사실로 인용하지 않는다.
