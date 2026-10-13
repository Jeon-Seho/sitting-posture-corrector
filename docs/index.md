# 문서 지도

## 현재 상태와 작업

현재 우선순위는 로컬 측정·개인 기준 특징이다. 서버/Kafka 확장은 후순위다.
[개발자 실험실 `/dev`](design/developer-lab.md): 큰 카메라·구도 가이드·자동 등록, 모델/룰 비교와 합성 데모.
서비스 승격과 의존성은 [개발 모듈 안내](../frontend/src/features/developer/README.md)에서 분리해 관리한다.
[개발 실행 경계](decisions/0024-local-development-server-boundary.md): 로컬에서 먼저 검증하고 동일 의미의 입력·결과로 서버에 연결한다. 새 전송 계약과 런타임은 후속 구현이다.
[기준 등록 자료 보존](decisions/0022-local-baseline-archive.md): 완료된 13점 기준 시계열을 로컬에 모으며 라벨은 개발상의 정상 가정이다.

웹캠 단일 앱, MySQL 이메일·비밀번호 계정, 영구 저장·API/CEP 복구, Compose·배포 자동화 설정의 코드가 있다.
현재 DB 스키마와 백엔드의 대응 여부는 [DB 안내](../database/README.md)를 확인한다.
학습된 LSTM 연결·실제 장치 품질/연구 효과·운영 배포 완료는 이 상태 설명에 포함되지 않는다.

- [개인 기준 특징 최종 점검표](research/personal-baseline-final-review.md): 유지할 결정·필수 보완·다음 비교. [설계 상세](research/personal-baseline-feature-design.md), [비교 결정](decisions/0023-baseline-feature-comparison.md).
- [ML / jisung 환경별 기록](ml/jisung/README.md): desktop·home 기록을 구분한 결정·구현 상태·테스트 브랜치 비교·인계.
- [팀 서비스 요구사항](removed-docs.md): 기능·역할·수용 기준·협의 항목.
- [실시간 경로 계획](plans/active/0022-kafka-realtime-pipeline.md): 팀·ML 확인 대기. [측정 불가](removed-docs.md), [구도와 멈춤 화면](design/setup-framing-and-pause-display.md).
- [서비스 DB 전환](removed-docs.md): API 구현과 현재 스키마의 대응 상태는 [DB 안내](../database/README.md)에서 확인한다.
- [데스크톱 화면 계획](plans/active/0020-desktop-app-redesign.md): [화면 설계](design/desktop-app.md), [연결 지점](design/frontend-platform-seams.md), [시각 규칙](../DESIGN.md).
- [현재 환경 인계와 과거 검증](development-handoff.md). main/develop 직접 push 금지.

## FE(lee_app1) 현재 결정과 작업 (2026-10-12)

- **결정:** [ADR 0021 앱은 정보만 보내고 판정은 서버가 한다](decisions/0021-app-sends-information-server-judges.md). 2026-10-11 이전 문서의 "좌표 미전송", "로컬 모드"는 바뀌기 전 설명이다.
- **용어:** 「라벨」은 서버·ML이 만드는 판정·학습 정답만 뜻한다. 앱은 라벨을 만들지 않는다. 수집 화면에서 참여자가 고르는 값은 「자기 보고 확인」이다.
- **FE 제안서:** [서버 판정 이전과 연동](design/fe-server-proposal.md) — 앱이 보내는 것·받는 것, BE 제안 확인, 남은 질문 N1~N15, FE 할 일 F1~F10. [합성 시험 데이터](../contracts/examples/frames/reference-rule-cases.json).
- **실행 계획:** [앱 판정 제거와 서버 결과 전용 화면](plans/active/0023-frontend-server-only.md)(0023), [자세 등록과 측정 시작 분리](plans/active/0024-posture-registration-tab.md)(0024).
- **명령과 검사:** [FE 작업 명령과 검사](design/fe-commands-and-checks.md), 설치할 프로그램 [requirements-front.txt](../requirements-front.txt).
- **수집:** 자세 데이터 수집 CSV는 [v3](research/guided-collection-v2.md)(앱 판정·특징 열 없음). 측정 결과 내보내기는 [session-export](research/session-export.md).
- **지운 문서:** 지금 결정과 다르거나 다른 곳으로 옮긴 문서(완료 계획, 점검 기록, 팀 요구사항 등 34개)는 지웠다. 목록·이유·되살리는 법은 [지운 문서 기록](removed-docs.md). 아래 표·목록에서 지운 문서를 가리키던 링크는 그 기록으로 바꿨다.

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
| 왜 이렇게 결정했는가? | [결정 이력](decisions/), [기술 검토](removed-docs.md) |
| 현재·다음 작업은? | [활성 계획](plans/active/), [백로그](plans/backlog.md), [계획 양식](plans/template.md) |

## 이력과 근거

[완료 계획](plans/completed/)에는 구현 범위와 당시 검증을, [감사 기록](removed-docs.md)에는 시점별 결과·한계를 남긴다.
최근 개인 파일럿은 [완료 0019](removed-docs.md), 카메라 창은 [완료 0018](removed-docs.md),
계정·Compose는 [완료 0017](removed-docs.md)을 참고한다.
[Mac 통합 점검](removed-docs.md), [lee 브랜치 기록](removed-docs.md), [페르소나 메모](removed-docs.md)는 해당 시점의 참고다.
과거 계획서의 스택·수치와 과거 작업 승인은 현재 작업의 의무나 권한으로 취급하지 않는다.

## 문서의 권위와 유지

사용자의 현재 요청을 기준으로 작업한다. 제품 범위·아키텍처·계약·연구 프로토콜은 각각 자신의 사실과 기준을 관리한다.
행동 변경은 관련 문서와 예제를 함께 갱신하고 중요한 결정은 ADR에 남긴다.
제공 원문은 수정하지 않으며 외부 문헌의 수치·주장은 검토 전까지 검증된 사실로 인용하지 않는다.
