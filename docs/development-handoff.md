# 개발 환경 인계

현재 요청과 `git status --short`, `git branch --show-current`를 먼저 확인한다. 기존 변경을 임의로 덮어쓰지 않는다.
협업 저장소의 main/develop에는 직접 push하지 않는다. 원격 쓰기·배포 권한은 과거 인계 기록으로 추정하지 않는다.

## 현재 구현과 진입점

- 웹캠 단일 앱과 선택형 API/CEP/FastAPI, MySQL 계정·영구 기록·복구가 구현돼 있다.
- Compose·배포·백업 복원 설정은 존재한다. 설정 존재와 운영 배포 완료는 구분한다.
- 현재 DB 스키마의 적용 순서와 백엔드 대응 상태는 [DB 안내](../database/README.md)에서 확인한다.
- 학습된 LSTM은 서비스에 연결되지 않았으며 실제 카메라 품질·음향·장시간·연구 정확도는 합성 검증과 별도다.
- 현재 범위·활성 계획은 [문서 지도](index.md), 수정 위치는 [코드 지도](code-structure.md)에서 확인한다.

## 새 환경에서 작업

[개발 흐름](development.md)의 런타임을 준비하고 최초 `make setup` 후 [품질 기준](quality.md)에 따라 검증한다.
전체 `make check`는 Python·프론트·Java·실제 HTTP·독립 Chrome·일회용 MySQL/Compose·복원을 포함한다.
부분 게이트 결과를 전체 성공으로 보고하지 않는다. 서버·시험 자원은 자신이 시작한 것만 종료한다.
[백엔드 실행](../backend/README.md), [Compose·비밀값·배포·백업](../infra/README.md), [계정 계약](../contracts/accounts.v1.md)을 따른다.
브랜치와 SHA는 실행 시 확인하며 이 문서에 특정 작업 브랜치를 상시 고정하지 않는다.

## 과거 검증과 한계

2026-09-30~10-01의 커밋·브랜치·권한 오류·검증 수·미구현 설명은 [당시 인계 이력](audits/2026-10-01-development-handoff.md)에 보존했다.
이는 해당 시점 기록이며 현재 기능 상태나 작업 지침으로 적용하지 않는다.
최근 작업의 실제 검증은 [완료 계획](plans/completed/)에 기록하며 원격 CI·실제 장치 확인과 구분한다.
