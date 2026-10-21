# 영상 중심 관측 화면 시각·조작 검수

- 날짜: 2026-10-16
- source visual truth: `/Users/js/.codex/generated_images/01a1164c-bb29-7ee2-a1ed-4fcbfa1d2c97/exec-22acbe44-9e6e-4659-ab98-99597711ce68.png`
- implementation: `http://127.0.0.1:5173/dev?view=observation`
- implementation screenshot: `/Users/js/.codex/visualizations/2026/10/07/01a1164c-bb29-7ee2-a1ed-4fcbfa1d2c97/observation-immersive-hold-1440.png`
- full-view comparison: `/Users/js/.codex/visualizations/2026/10/07/01a1164c-bb29-7ee2-a1ed-4fcbfa1d2c97/observation-immersive-comparison.png`
- focused comparison: `/Users/js/.codex/visualizations/2026/10/07/01a1164c-bb29-7ee2-a1ed-4fcbfa1d2c97/observation-immersive-detail-comparison.png`
- 추가 정지 화면: `/Users/js/.codex/visualizations/2026/10/07/01a1164c-bb29-7ee2-a1ed-4fcbfa1d2c97/observation-immersive-paused-1180.png`
- 최종 실제 측정 대기 화면: `/Users/js/.codex/visualizations/2026/10/07/01a1164c-bb29-7ee2-a1ed-4fcbfa1d2c97/observation-immersive-ready.png` (1168×853, 실제 카메라는 켜지 않음)
- source pixels: 1487×1058, 1440×1024로 정규화. 구현 CSS viewport·pixels: 1440×1024, density 1.
- 비교 상태: 양쪽 어깨 유지, 첫 바퀴, 5초 남음. 명시적인 합성 관측/시계 fixture를 사용했다.

## Findings

최종 비교에서 조치가 필요한 P0/P1/P2는 발견하지 못했다. 전체 화면과 타이머·게이지 확대 비교를 열어
위계·색상·글자·여백을 확인했고 별도 읽기 검수에서도 같은 결론을 확인했다.

- Fonts/typography: Pretendard Variable과 Outfit 600을 로컬 번들에서 사용한다. 큰 화면 타이머 120px,
  현재 동작 최대 38px, 제어 버튼 16px로 위계를 맞췄다. 짧은 화면은 타이머를 줄여 겹침을 피한다.
- Spacing/layout: 영상 모서리에 타이머·현재·다음 안내, 하단 중앙에 제어를 배치한다. 안내 중 준비 툴바를
  접어 영상을 넓힌다. 1180×760에서 HUD끼리의 겹침과 합성 얼굴/양어깨 점 가림이 없고 게이지 하단은
  y=688로 뷰포트 안이다. 정지 상태의 긴 안내와 세 버튼도 겹치지 않는다.
- Colors/tokens: 검정, 차콜 면과 라임/보라/핑크/하늘색을 사용한다. 카드 테두리·구분선 없이 색상 면으로
  구분하며 키보드 포커스 외곽선은 접근성을 위해 유지한다. 정지는 호박색과 '멈춤' 글자를 함께 쓴다.
- Image quality/assets: 시안의 가상 인물 사진은 실제 제품 자산이 아닌 카메라 슬롯이다. 제품은 실제 스트림을
  contain·좌우 반전으로 표시하며 원본 영상과 관측점은 같은 정렬을 유지한다. 검수에 실제 사람 영상을
  사용하지 않아 합성점만 보이는 것은 의도된 차이다. Phosphor 라이브러리 아이콘을 사용했다.
- Copy/content: 양쪽 어깨를 함께 올리도록 명시한다. 현재 단계/바퀴/다음 동작, 중단 자세 복구와 현재 단계
  재시작, 36구간 완료 및 CSV 수동 다운로드 의미를 보존한다. 판정·건강 점수·예측을 추가하지 않았다.

## Comparison history

1. 초기 전체 비교(v1): HUD·타이머·제어 글자의 크기가 선택 시안보다 작음(P2).
   근거: `observation-immersive-comparison-v1.png`, `observation-immersive-hold-1440-v1.png`.
2. 수정: 타이머 100→120px, HUD 204→260px, 제어 13→16px, 현재 동작 최대 34→38px.
   사용자 요청으로 게이지는 56px 높이에 단계·남은 초를 넣었다.
3. 최종 캡처/비교: 위 implementation/full-view/focused 파일에서 재검수. 글자 크기 위계를 복원했고
   남은 P0/P1/P2는 없다. 1180×760 정지 화면도 별도로 확인했다.

## Primary interactions and console

- 합성 입력으로 카메라 준비→2초 기준 등록→자동 안내 시작, 양어깨 유지 5→4초, 일시정지의 시간 고정,
  정지 중 CSV, 재개 시 5초 재시작, 완료 36/36구간 및 카메라 종료 상태를 확인했다.
- 최종 합성 CSV는 1,527행과 protocol_completed 표식이 있었다. Blob만 확인하고 디스크 다운로드를 막았다.
- 새 측정 전 기존 자료 보호 확인창과 CSV 접근도 확인했다. 실제 사용자 자료는 검수 fixture로 사용하지 않았다.
- CUA 브라우저 console error 조회 결과 0건. 임시 HTML/TSX fixture와 검수 탭은 최종 앱에 포함하지 않는다.
- 최종 실제 측정 탭에서도 세 게이지 높이 56px와 console error 0건을 확인했다. 기존 사용자 측정 탭은 보존했다.

## Open questions / Follow-up polish

- 실제 카메라 구도·조명·좁은 어깨 조건 및 실제 사람 동작은 별도 사용자 확인 대상이다.
- 시안의 가상 macOS/Windows 창 버튼은 구현하지 않는다. Electron 창 관리가 플랫폼 버튼을 소유한다.
- 수치·그래프·수동 비교표는 측정 영역 아래에서 펼친다. 사진과 OS 창 장식을 제외한 기능적 차이는 없다.
- 서버/DB 전체 브라우저 게이트와 실제 Electron 창 실행은 이번 로컬 UI 검수에 포함하지 않았다.

## Implementation checklist

- [x] 선택 시안과 최종 구현을 같은 비교 입력으로 확인
- [x] 타이머·게이지의 확대 비교와 다섯 fidelity surface 확인
- [x] 중단/재개/완료/CSV 및 자료 보호 확인창 검증
- [x] 실제 영상·참여자 자료·가짜 측정 결과를 제품에 추가하지 않음

final result: passed
