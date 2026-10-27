# 문서 지도

## 현재 상태와 작업

- [이메일 인증·비밀번호 재설정 연결 인계](design/email-account-handoff.md): 프론트 페이지/제안 API는 준비 단계이며 SMTP·서버·DB 연결은 후속이다.

웹캠 단일 앱, MySQL 이메일·비밀번호 계정, DB V2.3 저장과 API 안의 판정 엔진([ADR 0020](decisions/0020-single-api-decision-engine.md)), Compose·배포 자동화 설정의 코드가 있다.
앱은 관절 좌표를 보내고 판정은 서버가 한다(아키텍처 v5.2, [ADR 0021](decisions/0021-app-sends-information-server-judges.md)). 앱(FE V3, 10/21)은 `/v2/realtime`으로 측정한다([연동 명세](design/api-ws-spec.md), [ADR 0025](decisions/0025-app-always-measures-on-server.md)). 서버의 `/v1/realtime`은 develop에 합쳐진 뒤 BE가 정리한다.
현재 DB 스키마와 백엔드의 대응 여부는 [DB 안내](../database/README.md)를 확인한다.
학습된 LSTM 연결·실제 장치 품질/연구 효과·운영 배포 완료는 이 상태 설명에 포함되지 않는다.

- 팀 서비스 요구사항: 기능·역할·수용 기준·협의 항목은 저장소 밖 팀 구글 시트(디스코드 공유)에서 관리한다. [문서 이동 안내](removed-docs.md#3-feklaod-tech-이-pr-작성자가-만든-문서-9개)는 이동 기록이며 요구사항 원문은 아니다. 실제 시트 주소는 저장소에 미기재다.
- [실시간 판정 Kafka 전환](plans/active/0031-realtime-kafka-transition.md)(0031, 아키텍처 v5.2): API 안 판정을 Kafka 경로로 옮기는 단계·담당·차이 목록. 지운 계획 0022를 대신한다.
- [백엔드 재작성](plans/active/0026-backend-v2-rebuild.md): DB V2.2·프론트 계약 기준 단일 API. [서비스 DB 전환(V1.1)](removed-docs.md)은 이 계획으로 대체됐다.
- [프론트–API v2 연결](plans/active/0027-frontend-backend-v2-connection.md): 되돌린 프론트를 계정·기준 자세·세션 v2와 DB V2.3에 다시 잇는 수정 목록. FE 설계(실시간 v2·WS 자세 등록)와 다른 곳은 [계획 0029](plans/active/0029-merge-backend-data-platform.md) D1~D9.
- [백엔드 Java 17·Spring Boot 4·Gradle 전환](plans/active/0028-backend-java17-boot4-gradle.md)([ADR 0023](decisions/0023-backend-java17-boot4-gradle.md)): 백엔드·개발 도구 변경과 Docker·CI 팀원 작업 요청.
- [데스크톱 화면 계획](plans/active/0020-desktop-app-redesign.md): [화면 설계](design/fe-server-proposal.md)(8.3)·[데스크톱 창](design/fe-server-proposal.md)(8.4), [시각 규칙](../DESIGN.md).
- [현재 환경 인계와 과거 검증](development-handoff.md). main/develop 직접 push 금지.

## FE 현재 결정과 작업 (2026-10-21, 10/26 최신화, `feature/frontend-features-and-integrationV3`)

- **10/21 V3 서버 전용:** 앱은 항상 서버로 측정하고 판정하지 않는다(로컬 판정·이어하기·v1 서버 코드 삭제, develop에는 남아 있음). 자세 등록은 앱이 관절 9개 3초 평균을 내서 B1로(10/20 전체 회의). 측정은 S1 → `/v2/realtime` 좌표 구간. 로그인·W1 연결은 BE. 다음 할 일은 [FE 제안서](design/fe-server-proposal.md) 7.2.

- **결정:** [ADR 0021 앱은 정보만 보내고 판정은 서버가 한다](decisions/0021-app-sends-information-server-judges.md), [ADR 0024 서버 연결이 끊기면 세션을 끝낸다](decisions/0024-session-ends-on-lost-connection.md), [ADR 0025 앱은 항상 서버로 측정한다](decisions/0025-app-always-measures-on-server.md)(10/21), [ADR 0026 자세 등록은 앱이 3초 평균을 내서 B1로](decisions/0026-baseline-average-by-app-b1.md)(10/20 전체 회의), [ADR 0027 오늘 기록은 앱이 모은 서버 결과로, 이 기기에 키 하나](decisions/0027-today-records-from-collected-server-results.md)(10/22 팀장·10/25 FE), [ADR 0028 웹에는 작은 카메라 창을 두지 않고 데스크톱 앱에서만](decisions/0028-no-web-camera-window-desktop-only.md)(10/26 FE), [ADR 0029 측정은 KST 자정에 서버가 끊고, 날짜·시각은 서버 시각](decisions/0029-midnight-cut-and-server-time.md)(팀 회의, 10/26 문서화), [ADR 0032 판정 불가 프레임은 좌표 없이 신호만](decisions/0032-unmeasurable-frame-signal-only.md)(10/27 FE). 옛 방식의 ADR(0002·0003·0010·0012·0013·0017·0019·0022)에는 맨 위 상태 줄에 무엇으로 바뀌었는지 적었다.
- **연동 명세:** [앱 ↔ 입출구 서버 연동 명세](design/api-ws-spec.md) — 필드·본문은 [BE API 명세](design/api-spec.md), 이 문서는 앱이 언제 부르고 어떻게 움직이는지(10/22 정리). 로그인·설정·기록·자세 등록(B1)은 REST, 실시간 판정은 WebSocket `/v2/realtime`.
- **계약:** [WebSocket v2](../contracts/realtime/realtime-ws.v2.schema.json)·[합성 예시](../contracts/realtime/examples-v2/), [좌표 구간](../contracts/realtime/frames/posture-frames.v1.schema.json).
- **FE 제안서:** [서버 판정 이전과 연동](design/fe-server-proposal.md) — 1장 남은 질문(없음, 실시간 v2 확정 10/15)·BE 진행 중인 것, 2장 전제·결정, 3장 앱이 보내는 것, 4.1 화면 상태, 7장 FE 할 일, 8장 지금 앱(연결 설정·화면과 코드 위치).
- **배포:** [도메인 + Vercel + Cloudflare 터널](design/fe-deploy.md) — 화면은 Vercel(`app.`), 서버는 DevOps의 이름 있는 터널(`api.`). V3는 BE 브랜치 `fix/repo-backend-sync`와 함께 develop에 합치고, 운영(포크) 최신화는 서버가 준비된 뒤(10/26 정정. 10/22 이름 바꿈, 옛 `fe-domain-idea.md`). BE와 다른 곳은 [FE 제안서](design/fe-server-proposal.md) 1.0.
- **동의:** [개인정보 수집 동의](design/consent-proposal.md) — 회원가입 3단계(약관 동의 C1~C6 → 계정 정보 → 자세 등록 선택), 보유 기간 탈퇴 후 30일.
- **10/12~14 결정 요약(통계 표시 10/22 보완):** 가입·프로필 입력은 서버와 같게 이름 1~30자(FE·BE·DB 모두), 나이 14~120, 비밀번호 72바이트는 앱이 검사하고 12자 검사는 서버를 붙일 때 켠다(10/14). 판정 불가는 측정이 안 되는 모든 경우를 넓게 하나로(앱이 `valid:false`, DB `UNMEASURABLE`). 세션 판정·사건·요약과 어제까지의 일별 통계는 서버가 계산한다. 방금 끝난 세션은 결과 화면에 따로 표시하고, 오늘 목록·합산·달력·그래프는 로컬에 수집한 서버 결과로 표시한다. 기간 화면은 서버의 과거 통계와 로컬 오늘 값을 함께 사용한다([연동 명세 4.5](design/api-ws-spec.md#45-기록통계-r1r1br3t1-be-다음-주-범위)). 카메라는 640×480 고정(팀 결정). 5분 미만 세션도 저장하고 "붕괴까지 걸린 시간" 통계에서만 뺀다(DB V2.3, 10/14 정정). 기록·달력 화면은 lellon0403 담당(10/14 개편). 계정 서버 연결(F12)은 BE 담당(10/14).
- **10/16 탈퇴:** 탈퇴는 되돌릴 수 없다(BE 10/15, 철회 A8 없어짐). 탈퇴한 계정으로 로그인하면(403 `ACCOUNT_CLOSED`) 앱은 연락처 안내를 보인다([연동 명세](design/api-ws-spec.md) 0.7).
- **10/15 정리:** BE와 이름이 다르면 BE에 맞춘다(적재된 기록 삭제 거부는 409 `CONFLICT`). 배치 번호는 아키텍처 v5.2(J1 적재, J2 집계 00:00, J3 탈퇴 삭제 04:00). DB 저장 이름·단위는 [연동 명세](design/api-ws-spec.md) 1장, DB 제외 사유는 5.2. 실시간은 `/v2/realtime`으로 확정(BE 답). BE 브랜치의 v1은 서버를 먼저 돌려 보려고 섞인 임시 상태다.
- **실행 계획:** [앱 판정 제거와 서버 결과 전용 화면](plans/active/0023-frontend-server-only.md)(0023).
- **BE 브랜치와 합치기:** [계획 0029](plans/active/0029-merge-backend-data-platform.md). 10/15 PR #48, 10/21 PR #60으로 FE를 develop에 넣었다. 10/21 FE V3가 BE 브랜치를 받았다. 남은 것은 BE 브랜치가 develop에 들어오는 것.
- **작은 카메라 창·서버 로그인만:** [계획 0054](plans/active/0054-pip-fix-and-server-only-login.md)(10/22): 자동 PiP가 안 열리는 문제를 먼저 고치고, 그다음 시험 전용 로컬 로그인을 지워 서버 로그인만 남긴다. 10/26: 카메라만으로는 Chrome이 자동 PiP를 열지 않아 웹 작은 창을 지우고 숨은 탭 측정을 고쳤다(ADR 0028). 로그인 정리는 남음.
- **측정 중 WS 줄이기·결과는 API로:** [계획 0059](plans/active/0059-slim-realtime-results-over-api.md)(10/27 제안, 두 단계, 팀장·BE와 정하기 전. 정한 것: 측정 시계는 앱이 전체 시간으로, 측정 중 `keep_rate` 남김, S1 `policy` 빼기 BE-11): 측정 중에는 점수·판정 불가·`alerting`·`keep_rate`·알림만, 나머지는 끝난 뒤 S4로. 측정 시간은 앱이 더함
- **데스크톱 작은 카메라 창:** [계획 0057](plans/active/0057-native-camera-window-and-design-review.md)(lellon0403, develop PR #64, 10/26): 주소 없는 Electron 창, 접기·앱으로 돌아가기. V3의 [계획 0055](plans/active/0055-desktop-camera-window.md)는 10/27 이것으로 바꿈
- **카메라 여러 대:** [내장 + USB 카메라](plans/active/0053-multiple-cameras.md)(0053, 10/16: 측정하기에서 메인 카메라 선택, 기준 자세는 카메라와 상관없이 하나, 쓰던 카메라가 빠지면 측정 종료·저장. 10/21부터 기준 자세는 서버(B1·B2)에 있고, 앱이 닫힌 측정은 서버가 저장한다. 남은 것: 외장 자동 우선, 꽂으면 알림, 640×480 아니면 시작 안 함).
- **`make check` 실패:** [원인과 고칠 것](plans/active/0030-make-check-failures.md)(0030, 빌드 도구와 무관). 빌드는 BE 설정(Gradle Wrapper)을 따른다.
- **명령과 검사:** [FE 작업 명령과 검사](design/fe-commands-and-checks.md), 설치할 프로그램 [requirements-front.txt](../requirements-front.txt).
- **수집:** 자세 데이터 수집 CSV는 [v3](research/guided-collection-v2.md). 측정 결과 내보내기([session-export](research/session-export.md))는 10/21 앱에서 지웠다(예전 파일을 읽을 때만).
- **용어:** 「라벨」은 서버·ML이 만드는 판정·학습 정답만 뜻한다. 앱은 라벨을 만들지 않는다.
- **지운 문서:** 끝났거나 다른 문서와 겹친 문서는 지우고 [지운 문서 기록](removed-docs.md)에 이유·간 곳·되살리는 법을 남겼다. 지운 문서를 가리키던 링크는 그 기록으로 바꿨다.

## 질문별 진입점

- [포레스트 테마·KST 날짜별 기록 적용](plans/active/0058-forest-theme-and-kst-day-records.md), [날짜별 보관 결정](decisions/0031-kst-daily-measurement-parts.md): 최종 밝은 정보 영역·고유 자산·자정 관측 분리와 검증.

- [색상·레이아웃 재디자인 판단(2026-10-26)](audits/2026-10-26-visual-design-review.md): 실제 주요 화면 관찰, 브랜드 유지 범위, 배치·상태색 개선안.

- [앱·웹 PiP와 사용자 흐름 검토(2026-10-26)](audits/2026-10-26-pip-design-review.md): Chrome 출처 표시 제약, 현행 작은 창 문제, 정상 경로 조작 수와 재디자인 우선순위.

| 질문 | 기준 문서 |
| --- | --- |
| 무엇을 만드는가? | [제품 범위](product-spec.md), [원래 자료와 출처](references/README.md) |
| 어디에 구현하는가? | [아키텍처](architecture.md), [코드 지도](code-structure.md) |
| 어떻게 작업·실행하는가? | [AGENTS](../AGENTS.md), [개발 흐름](development.md), [프론트](../frontend/README.md), [백엔드](../backend/README.md) |
| 브랜치·커밋 이름은? | [Git 명명 규칙](../CONTRIBUTING.md) |
| 무엇을 검증하는가? | [품질 기준](quality.md) |
| 데이터와 API의 경계는? | [계약](../contracts/README.md), [DB](../database/README.md), [아키텍처 v5.2 스택별 역할](design/architecture_v5.2_stack_roles.md), [Kafka 명세](design/kafka-spec.md)(처리 서비스 층 토픽·메시지·DLQ), [처리 서비스 HTTP API](design/processing-api-spec.md)(운영·확인용) |
| 어떻게 배포·복원하는가? | [infra](../infra/README.md), 빅데이터 플랫폼(서버 PC)은 같은 문서의 "빅데이터 플랫폼" 절과 [아키텍처 v5.2 스택별 역할](design/architecture_v5.2_stack_roles.md) |
| 연구 분할·학습은? | [프로토콜](research/protocol.md), [자료 준비](research/dataset-preparation.md), [개인 실험](research/personal-pilot-training.md) |
| 수집은? | [Lite 수집 v2](research/guided-collection-v2.md), [파일럿 CSV](research/pilot-csv.md), [수집 진입 결정](decisions/0016-collection-entry-and-camera-preview-window.md) |
| 시간·특징 정책은? | [시간 정책](decisions/0012-session-timing-policy.md), [서버 특징](decisions/0013-frontend-server-feature-connection.md), [어깨 척도](decisions/0019-shoulder-tilt-scale.md) |
| 왜 이렇게 결정했는가? | [결정 이력](decisions/), [지운 문서 기록](removed-docs.md) |
| 현재·다음 작업은? | [활성 계획](plans/active/), [백로그](plans/backlog.md), [계획 양식](plans/template.md) |

## 이력과 근거

- [구간별 UI 검수(2026-10-26)](audits/2026-10-26-section-ui-review.md): 회원가입·측정·중단·종료·기록·설정·오류/작은 창의 배치와 대비 보정.

- [글자·여백 조사와 적용(2026-10-26)](audits/2026-10-26-typography-spacing-review.md): Fluent·Atlassian 공식 기준, 원형 지표의 안쪽 여백, 공통 글자 크기·행간·간격.

[완료 계획 폴더](plans/completed/)는 완료 문서의 보관 위치다. 삭제된 개인 파일럿(0019)·카메라 창(0018)·계정·Compose(0017) 문서의 정리 내역은 [지운 문서 목록](removed-docs.md)에서 확인한다. 이 목록은 원문의 구현 범위·검증 결과를 대신하지 않는다.
[현재 DB V2.3 연동 결정](decisions/0022-db-v23-feature-v2-integration.md)을 우선 참고한다.
과거 백엔드 V2(DB V2.2) 구현 범위·남은 일·문제는 [2026-10-10 현황](audits/2026-10-10-backend-v2-status.md)에 있다.
Mac 통합 점검·lee 브랜치 기록·페르소나 메모는 삭제된 문서이며, [정리 내역](removed-docs.md)을 참고한다.
과거 계획서의 스택·수치와 과거 작업 승인은 현재 작업의 의무나 권한으로 취급하지 않는다.

## 문서의 권위와 유지

사용자의 현재 요청을 기준으로 작업한다. 제품 범위·아키텍처·계약·연구 프로토콜은 각각 자신의 사실과 기준을 관리한다.
행동 변경은 관련 문서와 예제를 함께 갱신하고 중요한 결정은 ADR에 남긴다.
제공 원문은 수정하지 않으며 외부 문헌의 수치·주장은 검토 전까지 검증된 사실로 인용하지 않는다.
