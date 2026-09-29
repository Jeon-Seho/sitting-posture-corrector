# Surface brief: frontend (발표용 UI 데모, 6개 화면)

Scope: 로그인, 홈, 측정 준비, 실시간 측정, 대시보드, 설정. Mode: Operate (발표 시연 중 조작). 기능·카피·판정 로직은 유지하고 시각 세계만 교체한다.

## Direction contract

THESIS: 자세 기록을 대시보드 템플릿이 아니라 에이전시 피치덱의 한 권짜리 노트로 보여 준다. 둥근 다크 카드가 반복되는 SaaS 기본형을 거부한다.

OWN-WORLD: 스톤 크림 종이(#E6E1D5) 바탕, 검정 패널(#141312), 번트 오렌지(#E2683C) 한 가지 행동 색. 상태색은 청록(바른 자세)·라즈베리(붕괴)·머스터드(확인 중)·스톤 그레이(판정 불가). Anton 압축 굵은 숫자, Black Han Sans 한글 제목, Stardos Stencil 단계 숫자, Pretendard 본문. 모서리 4–6px, 카드 대신 굵은 잉크 괘선, 좌측 바인더 링.

STORY: 심사위원은 한 화면에서 "지금 자세 상태 → 붕괴가 확정되는 규칙 → 쌓인 기록"을 순서대로 읽고, 규칙이 실제로 돈다는 것을 믿는다.

FIRST VIEWPORT: 실시간 측정 화면. 왼쪽 60%는 검정 카메라 패널(키포인트, 기록 시간, 확인 막대), 오른쪽은 판정 패널: 상태 단어가 큰 Black Han Sans로, 붕괴 확률이 Anton 숫자로. 일시정지·측정 종료는 패널 바로 아래.

FORM: 사용자 지정 레트로 에디토리얼 피치덱 (roll 미실행, 사용자 지정 방향 우선). Seed key: none (pinned).

SIGNATURE INTERACTION: 판정 상태가 바뀌면 판정 단어가 상태색 띠로 clip-path 와이프되며 교체된다 (200ms, ease-out).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
