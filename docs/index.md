# 문서 지도

## 현재 상태와 작업

웹캠 단일 앱, MySQL 이메일·비밀번호 계정, DB V2.2 저장과 API 안의 판정 엔진([ADR 0020](decisions/0020-single-api-decision-engine.md)), Compose·배포 자동화 설정의 코드가 있다.
현재 DB 스키마와 백엔드의 대응 여부는 [DB 안내](../database/README.md)를 확인한다.
학습된 LSTM 연결·실제 장치 품질/연구 효과·운영 배포 완료는 이 상태 설명에 포함되지 않는다.

- [팀 서비스 요구사항](removed-docs.md): 기능·역할·수용 기준·협의 항목.
- [실시간 경로 계획](plans/active/0022-kafka-realtime-pipeline.md): 팀·ML 확인 대기. [측정 불가](design/unmeasurable-handling.md), [구도와 멈춤 화면](design/setup-framing-and-pause-display.md).
- [백엔드 재작성](plans/active/0026-backend-v2-rebuild.md): DB V2.2·프론트 계약 기준 단일 API. [서비스 DB 전환(V1.1)](removed-docs.md)은 이 계획으로 대체됐다.
- [프론트–API v2 연결](plans/active/0027-frontend-backend-v2-connection.md): 되돌린 프론트를 계정·기준 자세·세션 v2와 DB V2.3에 다시 잇는 수정 목록.
- [백엔드 Java 17·Spring Boot 4·Gradle 전환](plans/active/0028-backend-java17-boot4-gradle.md)([ADR 0023](decisions/0023-backend-java17-boot4-gradle.md)): 백엔드·개발 도구 변경과 Docker·CI 팀원 작업 요청.
- [데스크톱 화면 계획](plans/active/0020-desktop-app-redesign.md): [화면 설계](design/desktop-app.md), [연결 지점](design/frontend-platform-seams.md), [시각 규칙](../DESIGN.md).
- [현재 환경 인계와 과거 검증](development-handoff.md). main/develop 직접 push 금지.

## FE(lee_app1) 현재 결정과 작업 (2026-10-12)

- **결정:** [ADR 0021 앱은 정보만 보내고 판정은 서버가 한다](decisions/0021-app-sends-information-server-judges.md). 2026-10-11 이전 문서의 "좌표 미전송", "로컬 모드"는 바뀌기 전 설명이다.
  [ADR 0022 서버 연결이 끊기면 세션을 끝낸다](decisions/0022-session-ends-on-lost-connection.md)(세션 번호는 날짜마다 1부터).
- [앱–서버 연결 지도](design/fe-server-integration-map.md): 기능별 연결 상태(연결됨·준비됨·대기), 연결 스위치, 붙이는 순서.
- **용어:** 「라벨」은 서버·ML이 만드는 판정·학습 정답만 뜻한다. 앱은 라벨을 만들지 않는다. 수집 화면에서 참여자가 고르는 값은 「자기 보고 확인」이다.
- **FE 제안서:** [서버 판정 이전과 연동](design/fe-server-proposal.md) — 앱이 보내는 것·받는 것, 남은 질문(4장), FE 할 일 F1~F12. [합성 시험 데이터](../contracts/examples/frames/reference-rule-cases.json).
- **10/12 회의:** 판정 불가는 범위를 넓게 잡아 하나로 처리하고(DB `exclusion_reason`은 모두 `UNMEASURABLE`, 세분화할 때 CHECK 선택지를 늘림), 기준은 측정이 안 되는 모든 경우(귀·어깨·사용자가 안 보임 등)이며 앱이 판단해 서버에 보낸다. 통계는 전부 백엔드가 계산하고 앱은 표시만 한다. 당일은 세션 단위로만 보이고 날짜별 합산은 24시가 지나 반영된다. 5분 미만 세션은 결과만 보이고 저장하지 않는다([판정 불가 처리](design/unmeasurable-handling.md) 0장). 화면 정리(세션·이벤트·평균 간격을 지우고 최소·최대 간격 표시)는 다른 담당자가 맡고, 우리는 서버 전송과 판정 불가 처리만 한다.
- **API 명세(초안):** [앱 ↔ 입출구 서버 REST·WebSocket](design/api-ws-spec.md) — 로그인·설정·기록·지난 통계는 REST, 측정 좌표와 실시간 결과는 WebSocket.
- **동의 제안서(초안):** [개인정보 수집 동의](design/consent-proposal.md) — 가입 동의 C1~C6, 보유 기간 탈퇴 후 30일. 실제 서비스는 학습용 데이터를 받지 않는다.
- **실행 계획:** [앱 판정 제거와 서버 결과 전용 화면](plans/active/0023-frontend-server-only.md)(0023), [자세 등록과 측정 시작 분리](plans/active/0024-posture-registration-tab.md)(0024).
- **명령과 검사:** [FE 작업 명령과 검사](design/fe-commands-and-checks.md), 설치할 프로그램 [requirements-front.txt](../requirements-front.txt).
- **수집:** 자세 데이터 수집 CSV는 [v3](research/guided-collection-v2.md)(앱 판정·특징 열 없음). 측정 결과 내보내기는 [session-export](research/session-export.md).
- **지운 문서:** 지금 결정과 다르거나 다른 곳으로 옮긴 문서(완료 계획, 점검 기록, 팀 요구사항 등 33개)는 지웠다. 목록·이유·되살리는 법은 [지운 문서 기록](removed-docs.md). 아래 표·목록에서 지운 문서를 가리키던 링크는 그 기록으로 바꿨다.

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
| 왜 이렇게 결정했는가? | [결정 이력](decisions/), [기술 검토](removed-docs.md) |
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
