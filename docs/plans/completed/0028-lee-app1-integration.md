# lee_app1 반영과 로컬 작업 복원

- 상태: completed
- 담당: Codex
- 시작일: 2026-10-12
- 관련 요구사항/ADR: 사용자 요청으로 lee_app1을 현재 작업 브랜치에 반영

## 문제와 완료 기준

lee_app1의 41개 커밋을 반영하며 로컬 Heavy·13점·기준 자료 보존·MediaPipe 모듈 분리 변경을 유지한다.
문서·수집 CSV v3·등록 탭 변경과 겹친 내용을 병합하고 충돌 표시·타입/빌드·관련 검증을 확인한다.

## 범위와 제외

요청 브랜치 반영과 기존 작업의 충돌 해결. 새로운 모델·임계값·서버 기능은 구현하지 않는다.
원격에서 삭제한 과거 문서의 로컬 링크 수정은 백업 stash에 보존하고 삭제 정리를 따른다.

## 작업 단계

- [x] 원격·로컬 작업 상태 확인 및 stash 보관
- [x] lee_app1 fast-forward 반영
- [x] 기존 작업 복원·충돌 해결
- [x] 관련 검증·문서 동기화

## 결정과 진행 기록

작업 브랜치 codex/repo-baseline-mediapipe, 반영 대상 8ab1c18.
stash는 검증 후에도 원래 변경 복구용으로 보관한다. 서버 전환 계획과 로컬 실험 우선순위를 구분한다.
원격의 자세 등록 탭·앱 실행 중 기준 유지·좌표 CSV v3·귀 기반 offset/turn 규칙을 반영했다.
로컬의 Heavy 모델·13점 선택·별도 기준 archive·MediaPipe 모듈 분리와 기존 화면 변경을 복원했다.
과거 코·어깨 규칙과 현재 귀 기반 규칙의 차이, CSV v3와 기존 자료 준비 도구의 지원 범위를 문서에 반영했다.

## 검증 결과와 남은 한계

- `python tools/dev.py check-frontend`: 테스트 43파일·314개 통과, TypeScript와 프로덕션 빌드 통과. 번들 크기 경고가 남아 있다.
- `.venv/Scripts/python.exe -X utf8 .cache/local-baseline-browser.py`: 기존 브라우저 검증 모듈을 임시 로컬 실행기로 호출해 18개 통과. 기준 13점·가정 라벨·JSON 내려받기·재시작 보존, 수집 화면/미리보기, 실제 카메라 어댑터와 분리 추적기의 합성 연결·만료·종료를 확인했다.
- `python tools/dev.py check-browser`: 프로덕션 합성 진입점 제외 검사 통과 후 API·CEP JAR 누락으로 실패. 서비스 정리는 완료됐다. 서버를 포함한 전체 화면 검증은 미완료다.
- `python tools/dev.py check-repo`: 저장소·문서 검사 통과.
- `git diff --check`, `git diff --cached --check`: 공백 오류 없음. 충돌 표시는 남아 있지 않다.

전체 `make check`는 실행하지 않았다. 실제 모델/장치 성능은 이 병합 검증에 포함하지 않는다.
원격 커밋은 반영하고 복원된 로컬 변경은 미커밋 상태로 유지한다. 백업 stash는 삭제하지 않는다.
