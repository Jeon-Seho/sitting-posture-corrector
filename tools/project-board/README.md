# 바른자세 로컬 관리판

아르케 관리판의 현황·보드·메모 흐름을 바른자세 저장소에 맞춰 구현한 독립 개발 도구다.
단계별 프로젝트 여정, MD 본문 검색·읽기, 번호 카드 집계, 6명 팀원 배정, 카드·AI 메모 파일 저장을 제공한다.

## 실행

저장소 루트 `바른자세_관리판.bat` 더블클릭 → [화면](http://127.0.0.1:8774/).
또는 `python tools/project-board/launch.py`. Python 3.9 이상, 외부 의존성 없음.
서버만 포그라운드로 실행하고 종료하려면 `python tools/project-board/server.py` 후 Ctrl+C.
백그라운드 실행은 콘솔 창을 띄우지 않는다. 종료가 필요하면 작업 관리자에서 이 도구의 server.py 프로세스를 확인해 종료한다.
코드를 갱신한 경우 실행 중인 서버를 종료한 뒤 실행기를 다시 연다.
실행기는 `git pull` 뒤 내 작업 표시(`.githooks`, `work.py mine`)를 켠다. 자세한 내용은 [관리판 운영](../../docs/project-board.md).

## 파일과 API

| 파일 | 책임 |
| --- | --- |
| server.py | loopback 서버, 문서 목록, 검증, 버전 충돌 검사, 원자 저장 |
| launch.py | 중복 실행·다른 체크아웃 확인, 숨김 서버 실행, 브라우저 열기 |
| index.html / style.css / app.js | 화면, 안전한 MD 렌더링, 필터, 팀 배정, 편집·백업 |
| workspace.json | cards, notes, assignments의 파일 정본 |
| board_cli.py | AI 접수함 조회와 처리 결과 추가 |
| work.py / docs.py | 번호 작업 수명주기와 범위를 좁힌 문서 지도 |
| collaboration.py | 원격 브랜치 갱신·미커밋 파일 겹침 알림 |
| stages.json | 프로젝트 단계와 완료 기준·주요 문서 |
| fonts/ | Pretendard 가변 폰트와 SIL Open Font License |
| team.json | 사용자 확인 GitHub 계정과 커밋 작성자 별칭 |

GET `/api/health`, `/api/documents`, `/api/workspace`, `/api/activity`, `/api/stages`, `/api/collaboration`.
POST `/api/workspace`는 같은 Origin과 `{data, version}`을 요구한다. 버전이 다르면 409.
읽기·쓰기 모두 승인된 Host만 받는다. 문서 본문은 텍스트로 읽고 HTML을 실행하지 않는다.
저장 도중 서버 장애 등으로 .tmp가 남아도 정본을 임의 교체하지 않는다.

## 검증과 운영

`python -m unittest discover -s tests -p test_project_board.py -v`

Node가 있으면 `node --check tools/project-board/app.js`로 문법도 검사한다.
전체 저장소 검증은 `make check`. Windows에서 make가 없으면 `python tools/dev.py check`를 사용한다.
상세 규칙·팀 배정·AI 명령은 [관리판 운영](../../docs/project-board.md)을 따른다.
