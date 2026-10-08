# 개발 흐름

## 환경과 명령

```sh
make setup            # 최초 Python/프론트 의존성과 MediaPipe 모델 준비
make check-repo       # 구조·문서·산출물 검사
make test             # Python 계약·연구 도구·하네스 회귀
make check-frontend   # 프론트 테스트·타입·빌드
make check-backend    # Java·합성 HTTP·짧은 benchmark, 시험 서버 정리
make check-browser    # 준비된 프론트 빌드/JAR로 합성 앱·서버 흐름
make check-compose    # 실제 임시 MySQL·계정 UI·백업 복원
make check-local      # 영구 모드를 제외한 게이트
make check            # 전체 게이트
make init-compose     # Git 제외 local secret 준비
make benchmark-server # 준비된 JAR로 별도 성능 측정
make dev              # 로컬 웹캠/시연 앱
```

`make`가 없는 Windows는 `python tools/dev.py <대상>`을 사용한다. Makefile은 같은 스크립트를 호출한다([ADR 0009](decisions/0009-cross-platform-dev-entry.md)).
새 Windows PC의 `tools/setup-windows.ps1`은 Git·Node·Python 준비, 저장소·setup·바로가기를 지원한다(`-Repo`, `-Branch`).

Python 3.9+, Node.js 24+, JDK 21·Maven, Chrome/Chromium을 사용한다.
`make setup`은 네트워크로 의존성과 모델을 준비한다. 부분 준비는 `setup-python`, `setup-frontend`다.
프론트는 npm lockfile, Python 직접 의존성은 `requirements-dev.txt`를 따른다. Python 전이 의존성 전체의 연구 재현 잠금은 별도 결정이다.
전체 게이트는 Docker daemon·Compose가 필수이며, `check-local`에도 Python 구성 검사용 Docker CLI는 필요하다.
CI에서만 `POSEGOOD_CHROME_NO_SANDBOX=1`을 사용하고 로컬 Chrome은 기본 sandbox를 유지한다.

서버 준비·독립 `dev-api`/`dev-cep`/`dev-inference`는 [backend 안내](../backend/README.md),
계정 앱·배포·백업은 [infra 안내](../infra/README.md), 웹캠은 [frontend 안내](../frontend/README.md)를 따른다.
검증 선택·실패 기준·합성 입력 경계·결과 보고는 [품질 기준](quality.md), 성능 측정은 [benchmark 안내](audits/2026-10-01-server-benchmark.md)에 모은다.

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
