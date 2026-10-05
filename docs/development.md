# 개발 흐름

## 환경 준비와 빠른 피드백

```sh
make setup       # Python/프론트 의존성과 MediaPipe 모델 준비 (최초 실행에 네트워크 필요)
make check-repo  # 표준 라이브러리만으로 구조와 문서 검사
make test        # 출력 계약과 하네스 회귀 검증
make check      # CI와 동일한 전체 게이트, 실행 중인 Docker/Compose 필요
make check-local # 기존 로컬/메모리 모드 게이트, 전체 검증과 구분
make check-compose # 실제 MySQL·Compose·계정 UI·백업 복원
make init-compose # 무시되는 로컬 secret 파일 준비
make check-backend # Java API/CEP와 합성 FastAPI HTTP 흐름, 시험 서버 자동 종료
make check-browser # JAR 준비 후 합성 브라우저·실제 서버 전체 흐름, Chrome/Chromium 필요
make benchmark-server # JAR 준비 후 합성 서버 지연·처리량 측정, JSON은 .cache/benchmarks/server.json
make dev        # 웹캠/데모 프론트 프로토타입
```

`make`가 없는 Windows에서는 같은 대상을 `python tools/dev.py <대상>`으로 실행한다(예: `python tools/dev.py setup`, `python tools/dev.py check`).
`Makefile`은 이 스크립트를 호출만 하므로 두 방법의 결과는 같다. 근거는 [ADR 0009](decisions/0009-cross-platform-dev-entry.md).
새 Windows PC는 `tools/setup-windows.ps1`이 Git·Node.js LTS·Python(없을 때 winget), 저장소, `setup`,
바탕화면 바로가기(`PoseGood (개발)`, `바른자세 관리판`)를 한 번에 준비한다. 인자: `-Repo`, `-Branch`.

Python 3.9 이상을 사용한다. CI는 3.9와 3.12에서 확인하도록 구성한다.
서버 검증은 JDK 21과 Maven을 사용한다. [서비스 준비·실행](../backend/README.md)을 따른다.
`make dev-api`, `make dev-cep`, `make dev-inference`는 각각 하나의 loopback 서비스만 실행한다.
프론트는 Node.js 24 이상과 npm을 사용한다. `make setup`이 npm lockfile 기준으로 설치하고 MediaPipe 모델을 준비한다.
`make check-frontend`는 상태 전이·품질 테스트, 타입 검사, 빌드를 실행한다. `make check`에도 포함된다.

`make check`의 브라우저 게이트에는 Chrome/Chromium이 필요하다. 프론트 빌드와 서버 JAR를 준비한 뒤 `make check-browser`로
별도 실행할 수 있다. 독립 임시 프로필과 개발 테스트 모드의 합성 입력으로 앱·API·추론·CEP를 연결하며
실제 카메라를 사용하지 않는다. 일반 개발과 프로덕션에서는 합성 카메라 모드를 사용하지 않는다.
확인창의 Tab/Shift+Tab·Esc·초점 복귀·배경 조작 차단도 실제 브라우저에서 검증한다.
`make check-backend`에는 성능 합격 수치를 두지 않는 짧은 benchmark 회귀가 포함된다.
별도 측정 조건·보고서 해석은 [서버 benchmark](audits/2026-10-01-server-benchmark.md)를 따른다.
[자료 준비 CLI](research/dataset-preparation.md)의 합성 분할·시간 창·개인 기준/누수 검증은 Python 게이트에 포함된다.
프론트만 준비하려면 `make setup-frontend`를 사용한다. 웹캠 사용 흐름과 제약은 [프론트 안내](../frontend/README.md)를 참고한다.
`requirements-dev.txt`는 직접 의존성 버전을 고정한다. 전이 의존성 전체를 잠근 환경은 아니며,
실험 재현에 사용할 런타임·ML 의존성 잠금은 스택 결정 작업에서 별도로 추가한다.

전체 게이트는 실제 MySQL의 통합 테스트를 필수로 실행한다. Docker가 없거나 꺼졌으면 실패한다.
`check-local`은 Docker 없이 기존 앱/메모리 모드 검증을 반복할 때 사용하며 영구 모드를 확인한 결과로 보고하지 않는다.
Compose 계정 앱의 간단한 실행과 GitHub 배포 환경 설정은 [infra 안내](../infra/README.md)를 따른다.

## 작업 루프

관리판에 남긴 관련 요청은 [웹·AI 운영 규칙](project-board.md)에 따라 `board_cli.py inbox`에서 확인한다.
처리 후에는 해당 정본과 메모 결과를 함께 갱신한다. 작업 배정은 [팀 명단](team.md)을 사용한다.

1. 요청과 관련 문서를 확인하고 완료 기준을 정한다.
2. 큰 변경은 [계획 양식](plans/template.md)을 `plans/active/`에 복사한다.
3. 구현과 필요한 검증을 함께 작성한다. 실패·측정 불가·입력 누락 경로를 포함한다.
4. `make check`와 변경 컴포넌트의 명령을 실행한다.
5. 문제를 수정하고 재검증한 뒤, 결과·한계·설계 결정을 문서화한다.
6. 완료 기준이 모두 충족되면 계획을 `completed/`로 옮기고 링크를 수정한다.

## 컴포넌트 구현 시 확장

첫 실제 구현 PR에서 실행 방법과 검증 명령을 컴포넌트 문서에 추가한다.
프론트는 빌드/타입/핵심 UI 흐름, 서버는 API/오류 처리, 모델은 합성 시퀀스/평가 분할,
DB는 마이그레이션 왕복 검증을 포함한다. 필요한 환경 준비를 `make setup`에, 검증을 `make check`와 CI에 연결한다.
카메라·GPU·실제 참여자 데이터가 필요한 실험은 별도 명령으로 제공하고 기본 PR 검증과 구분한다.

## 검증 실패 시

오류 메시지의 파일·필드를 확인하고 원인을 고친다. 검사를 삭제하거나 fixture를 실제 데이터로 바꿔 우회하지 않는다.
실행 환경이 없어 확인하지 못했다면 계획과 결과에 미검증으로 명시한다.
민감 데이터 검사는 경로·확장자 기반 보조 장치이며, 파일 내용의 개인정보·비밀값을 탐지하는 도구가 아니다.
