# 개발 흐름

## 환경과 명령

```sh
make setup            # 최초 Python/프론트 의존성과 MediaPipe 모델 준비
make test             # Python 계약·연구 도구·하네스 회귀
make check-frontend   # 프론트 테스트·타입·빌드
make check-backend    # Java 기본 시험·Checkstyle·빌드
make check-local      # check의 별칭
make check            # Python → 프론트 테스트·타입·빌드 → 백엔드 기본 검사
make init-compose     # Git 제외 local secret 준비
make dev              # 로컬 웹캠/시연 앱
```

`make`가 없는 Windows는 `python tools/dev.py <대상>`을 사용한다. Makefile은 같은 스크립트를 호출한다([ADR 0009](decisions/0009-cross-platform-dev-entry.md)).
새 Windows PC의 `tools/setup-windows.ps1`은 Git·Node·Python 준비, 저장소·setup·바로가기를 지원한다(`-Repo`, `-Branch`).

Python 3.9+, Node.js 24+, 컴파일·시험용 JDK 17과 Checkstyle용 JDK 21을 준비한다. 백엔드는 Gradle Wrapper(`backend/gradlew`)로 빌드하므로 Gradle·Maven을 따로 설치하지 않는다.
두 JDK가 Gradle에 발견돼야 한다. Windows의 일반 JDK 설치 경로 또는 CI의 `JAVA_HOME_17_X64`·`JAVA_HOME_21_X64`를 사용한다. 기존 CI·Docker 설정은 유지한다.
`make setup`은 네트워크로 의존성과 모델을 준비한다. 부분 준비는 `setup-python`, `setup-frontend`다.
프론트는 npm lockfile, Python 직접 의존성은 `requirements-dev.txt`를 따른다. Python 전이 의존성 전체의 연구 재현 잠금은 별도 결정이다.
기본 검사에는 MySQL·Chrome·Docker·Compose가 필요하지 않다. MySQL 통합과 브라우저 점검은 준비된 시험 환경에서 [품질 기준](quality.md#명시적으로-실행하는-검증)의 직접 명령으로 실행한다.
구형 저장소 검사·종합 브라우저/Compose 검사·서버 benchmark 명령은 2026-10-29 제거했다. 기본 검사 성공을 이 통합 경로의 검증으로 표현하지 않는다.

서버 준비·독립 `dev-api`/`dev-inference`와 시험용 MySQL은 [backend 안내](../backend/README.md),
계정 앱·배포·백업은 [infra 안내](../infra/README.md), 웹캠은 [frontend 안내](../frontend/README.md)를 따른다.
검증 선택·실패 기준·합성 입력 경계·결과 보고는 [품질 기준](quality.md)을 따른다. 변경한 문서 링크와 `git diff --check`는 일회성으로 확인한다.

## 작업 루프

새 브랜치와 커밋의 이름은 [Git 명명 규칙](../CONTRIBUTING.md)을 따른다. Git hook은 사용하지 않는다.

1. 현재 요청·git status와 관련 문서/컴포넌트 AGENTS·계약을 확인한다.
2. 여러 컴포넌트·계약·연구 설계 변경은 [계획 양식](plans/template.md)으로 활성 계획을 기록한다. 작은 수정에는 강제하지 않는다.
3. 요청 범위의 변경과 필요한 성공/실패·측정 불가·입력 누락 검증을 구현한다.
4. [범위별 검증](quality.md)을 실행한다. 전체 성공 후 포함된 검사를 반복하지 않는다.
5. 행동이 바뀌면 문서·계약·예제를 함께 갱신하고 결과와 남은 한계를 기록한다.
6. 완료 기준을 충족하면 계획을 completed로 옮기고 링크를 갱신한다.

새 컴포넌트의 환경 준비와 실제 검증은 `make setup`/`make check`·CI에 연결한다.
카메라·GPU·실제 참여자 실험은 기본 합성 검증과 구분한 별도 명령으로 제공한다.

## 검증 실패 시

실패한 파일·필드를 확인하고 원인을 고친다. 검사를 삭제하거나 실제 데이터로 바꿔 우회하지 않는다.
환경이 없으면 실행하지 못한 검증과 이유를 기록한다.
