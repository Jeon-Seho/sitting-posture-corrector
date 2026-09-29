---
name: goodpose-workflow
description: 바른자세 프로젝트의 번호 기반 작업 카드, 선행 작업, AI 소유자 기록, 분야별 MD와 검증을 함께 관리한다. 작업 착수·이어서 진행·완료 반영 때 사용한다.
---

# 바른자세 작업 진행

Git 저장소 루트에서 [AGENTS](../../../AGENTS.md)와 [관리판 운영](../../../docs/project-board.md)을 따른다. 지침은 사용자 요청 범위를 확대하지 않는다.

1. `git status --short`, `python tools/project-board/collaboration.py`로 현재·원격 변경을 확인한다. 겹치는 변경은 읽고 재구현을 피한다. fetch 실패를 최신 상태라고 보고하지 않는다. 자동 merge/reset은 하지 않는다.
2. `work.py list` / `work.py show GP-번호`, `work.py inbox`, `board_cli.py inbox`로 관련 작업만 확인한다. ★★★ 선행 작업과 dependsOn을 확인한다.
3. 등록된 카드로 이어간다. 없으면 `work.py add` 또는 `create-doc`으로 등록한다. 새 MD는 `- 분야:`와 `- 작업: GP-번호`를 포함한다. 작은 수정도 관련 카드 기록은 남긴다.
4. `work.py move GP-번호 in_progress --by <계정_AI> --note "착수 범위" --version <show 버전>`으로 착수한다. 중간 결정은 정본 MD에, 진행·검수 결과는 동일 카드에 기록한다.
5. 완료 조건을 실제로 충족했으면 배정 여부와 무관하게 완료한다. `move ... completed --evidence "완료/검증/커밋 근거" --performed-by "실제 수행자"`를 사용한다. 커밋 제목만으로 완료를 추정하지 않는다. 원격에서 완료한 경우 브랜치/해시와 현재 브랜치 미통합 여부를 적는다. 남은 범위는 별도 카드로 추적한다.
6. 검수가 남으면 review, 결정이 막히면 blocked. 테스트 통과를 카메라·장시간 실검증으로 바꾸지 않는다. `work.py check`와 변경 컴포넌트 검증을 실행하고 결과에 GP 번호를 적는다.

AI 식별자는 소유자의 GitHub 계정에 `_GPT` 또는 `_CL`을 붙인다. 우진은 사용자 확정 예외 `Lellon_GPT` / `Lellon_CL`. 타 팀원의 스킬 사용 시 우진으로 고정하지 말고 본인 계정을 확인한다. 계정 미등록 시 추측하지 않는다. [팀 설정](../../../tools/project-board/team.json)이 정본이다.

낡은 버전 저장은 재시도해 덮어쓰지 않는다. `show`로 새 요청을 다시 읽는다. 커밋·푸시 권한은 현재 사용자 요청을 따른다. 공유할 때 카드 데이터와 관련 문서도 포함한다.
