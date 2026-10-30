# jisung 브랜치에 백엔드 통합 브랜치 병합

- 상태: completed (로컬 병합, 전체 서비스 검증은 환경 준비 후 필요)
- 담당: jisung / Codex
- 시작일: 2026-10-15
- 관련 요구사항/ADR: [품질 기준](../../quality.md), [로컬 개발 경계](../../decisions/0024-local-development-server-boundary.md), [백엔드 통합 계획](../active/0029-merge-backend-data-platform.md)

## 문제와 완료 기준

사용자 요청에 따라 `feature/repo-jisung-local-forecast`에
`origin/feat/backend-data-platform-architecture`를 병합한다.
백엔드 기준 커밋 `0fe1bd6`과 jisung 기준 커밋 `e9b565e`가 모두 최종 이력에 포함되고,
미해결 충돌 없이 병합 커밋을 만든다. 실행한 검증과 환경상 실행하지 못한 항목을 구분한다.

## 범위와 제외

- 백엔드·DB·플랫폼·서비스 프론트의 원격 변경을 받는다.
- jisung의 `/dev`, `#forecast`, 공통 MediaPipe 모듈, 13점 관측·정상 수집·얼굴 비교·로컬 학습 경로를 보존한다.
- 서비스 화면의 기준 자료·어깨 상태·카메라 FPS 기능과 연구 카메라 옵션을 함께 유지한다.
- 기존 `codex/heavy-guided-collection`의 미커밋 연구 문서 9개는 별도 복사본과 이름 있는 stash로 보존한다.
- 보안 분석·재작성·원격 push·배포·실제 참여자 실험은 범위 밖이다.

## 작업 단계

- [x] 관련 문서와 현재 구현 확인
- [x] 기존 미커밋 문서의 SHA-256 검증 백업 및 stash 보관
- [x] jisung 브랜치 전환과 백엔드 병합 시작
- [x] 충돌 해결 및 필요한 실패 경로 검증
- [x] 문서·계약 동기화
- [x] `docs/quality.md`의 범위별 검증과 결과 기록
- [x] 병합 커밋에 양쪽 기준 커밋을 포함하도록 준비하고 미해결 충돌 없음 확인

## 결정과 진행 기록

- 2026-10-15: 원격을 갱신했다. 백엔드 통합 브랜치에는 jisung에 없는 커밋 173개,
  jisung에는 백엔드 통합 브랜치에 없는 커밋 4개가 있다.
- 2026-10-15: 수정 파일 2개와 미추적 연구 문서 7개의 복사본을 검증하고,
  `pre-jisung-backend-merge: codex/heavy-guided-collection research docs` stash에 보관했다.
  이 자료는 이전 브랜치의 미완료 작업이며 병합 커밋에 포함하지 않는다.
- 2026-10-15: `git merge --no-ff --no-commit`에서 12개 경로의 충돌이 발생했다.
  프론트 카메라·진입점, 문서·계약, Python 의존성을 각각 해결했다.
- 2026-10-15: 로컬에 `make`, 프로젝트 `.venv`, 프론트 `node_modules`가 없고 Docker daemon이 실행되지 않았다.
  사용 가능한 기본 Python은 3.14.4이며 연구 의존성은 기존 Python 3.9/3.12 대상 핀을 그대로 유지한다.
- 2026-10-15: 번들 Python 3.12.14로 저장소 전용 `.venv`를 만들고 고정 의존성을 설치했다.
  `npm ci --ignore-scripts --no-audit --no-fund`와 기존 자산 준비 스크립트로 프론트 검증 환경을 준비했다.
  설치 결과·공식 MediaPipe 자산·Gradle 캐시는 Git 제외 경로에만 둔다.
- 2026-10-15: 원본 13점·모델 ID·관측 시계·연구용 추적 옵션은 공통 MediaPipe 모듈에 유지했다.
  서비스 어깨 유예는 파생 특징에만 적용하고 원본 수집 좌표를 교체하지 않는다.
  사용자 FPS 설정과 SDK 촬영 시각을 공통 추적기에 연결하고 해당 회귀를 합성 테스트로 검증했다.
- 2026-10-15: 지워진 계획 0022는 삭제 상태를 유지하고 연구 계약과 `/dev`·`#forecast` 진입점을 보존했다.
  계획 0027의 지워진 연결 지도 링크는 현재 연동 명세로 바꿨다.

## 검증 결과와 남은 한계

| 실행 | 결과 |
| --- | --- |
| `python tools/dev.py check-repo` | 통과. 누락 링크 수정 후 저장소 구조·로컬 Markdown 링크·산출물 경로 확인 |
| `npm --prefix frontend run check` | Vitest 88개 파일·734개 테스트 통과, TypeScript 및 Vite 프로덕션 빌드 통과 |
| `.venv/Scripts/python.exe tools/dev.py check` (`make check`와 동일한 진입점) | 저장소 검사 통과 → Python 203개 중 202개 통과·1개 생략 → 프론트 734개·타입·빌드 통과 → 백엔드 Gradle 단계에서 실패 |
| Python 생략 1개 | 이 Windows 환경에서 심볼릭 링크를 만들 수 없어 기존 관련 테스트가 생략됨 |
| 백엔드 실패 원인 | Gradle 9.7.1 준비 후 Java 17 toolchain을 찾지 못했다. 설치된 JDK는 21이며 백엔드 Java 테스트는 실행되지 않음 |
| `git ls-files --unmerged` | 출력 없음. 12개 충돌 경로 모두 해결·스테이징 |
| `git diff --cached --check` | 원격에서 받은 파일 3곳의 기존 공백 문제. 이번 충돌 해결로 추가한 문제는 없음 |

- 전체 게이트를 통과했다고 보고하지 않는다. 백엔드 컴파일·Java 테스트·실제 MySQL·HTTP smoke·브라우저·Compose는 미검증이다.
  Docker daemon도 꺼져 있다. 이 작업에서 시스템 JDK를 교체하거나 Docker를 시작하지 않았다.
- Vite는 500 kB 초과 번들 경고를 냈지만 빌드는 성공했다.
- 기존 공백 문제는 `infra/docker/java.Dockerfile`, `platform/docs/FE연동안_BE검토의견.md`, `tools/test_mysql.py`에 있다.
- 프론트의 기존 `/api/v1` 경로와 백엔드 REST v2·현재 WS v1/목표 WS v2 사이의 연동 작업은 기존 계획 0027·0029에 남아 있다.
  브라우저 수집 시나리오의 이전 native select 조작도 후속 검증 대상이다. 병합이 이 연동 완료를 뜻하지 않는다.
- 실제 카메라·GPU 성능, 실제 사람에 대한 정확도, 운영 DB·원격 CI·배포·보안은 검증하지 않았다.
- 기존 미커밋 연구 문서는 `pre-jisung-backend-merge: codex/heavy-guided-collection research docs` stash와
  검증한 별도 복사본에 남아 있다. 원래 브랜치 기준 자료이므로 새 병합 커밋에 섞지 않았다.
