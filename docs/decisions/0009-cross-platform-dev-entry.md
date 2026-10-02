# ADR 0009: Windows를 포함한 공통 검증 진입점

- 분야: 데브옵스
- 작업: GP-0040

- 상태: 채택
- 날짜: 2026-09-28

## 근거

기존 `Makefile`은 `python3`, `.venv/bin/python`, `test -x`를 직접 사용해 macOS·Linux(CI는 ubuntu)에서만 동작했다. Windows에는 기본적으로 `make`가 없고, 설치하더라도 가상환경 인터프리터가 `.venv/Scripts/python.exe`라 `make test`가 실패했다. 팀원 다수가 Windows를 사용할 가능성이 높다.

## 결정

- 준비·검증 단계는 표준 라이브러리만 쓰는 `tools/dev.py` 한 곳에 구현한다. 운영체제별 가상환경 경로와 `npm` 실행 파일 위치를 여기서 처리한다.
- `Makefile`의 모든 대상은 `$(PYTHON) tools/dev.py <대상>`만 호출한다. Windows에서는 `python`, 그 밖에서는 `python3`를 기본값으로 쓴다. CI와 기존 `make check` 사용법은 바뀌지 않는다.
- `make`가 없는 환경에서는 `python tools/dev.py setup`, `python tools/dev.py check`를 사용한다.
- `tests/test_repository.py`가 `Makefile` 대상과 `tools/dev.py` 명령의 일치를 검사한다.

## 결과와 한계

Windows 11(Python 3.13, Node 24)에서 `python tools/dev.py check` 통과를 확인했다. Linux의 `make` 경로는 이 변경 시점에 로컬에서 실행하지 못했고 CI에서 확인한다. Python 3.9 호환은 문법 검사로만 확인했다.

이전 결정: [저장소 하네스](0001-repository-harness.md).
