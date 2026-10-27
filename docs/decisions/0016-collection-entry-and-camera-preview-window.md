# ADR 0016: 수집 바로가기와 카메라 미리보기 창

- 상태: accepted
- 날짜: 2026-10-02
- 부분 변경(2026-10-26 사용자 결정): 카메라 작은 창은 Electron 앱 전용이다. 웹에서는 자동·수동 PiP 요청과 떠 있는 미리보기를 제공하지 않는다. 앱은 아래 native 창 결정을 따르며 브라우저 PiP API를 더 이상 사용하지 않는다.
- 근거: 사용자 요청 — 자세 선택 확인, 다른 주소에서도 이동 가능한 카메라 창
- 부분 변경: [ADR 0017](0017-desktop-app-shell-and-redesign.md) — 데스크톱 시작 프로그램의 선택형 자동 카메라, 큰 카메라 화면에서 작은 창 숨김

## 결정

로컬 미리보기에는 `/#collection` 바로가기를 제공한다. 시작 화면의 ‘프로필 없이 자세 데이터 수집’에서도
같은 화면을 연다. 프로필/계정을 만들거나 기록을 업로드하지 않고 기존 CSV 수집 controller만 사용한다.
계정 모드의 인증 경계는 유지한다. 자세와 촬영 길이는 카메라 연결 여부와 관계없이 페이지 위쪽에서 고른다.

카메라가 켜져 있으면 앱 전체에서 기존 스트림을 보여 주는 작은 창을 유지한다. 제목 드래그/방향키로 이동,
모서리로 크기 변경, 접기/펼치기, 명시적 카메라 종료를 제공한다. 일반 화면 이동은 진행 중 기준 보정만 취소하고
카메라를 유지한다. 종료·로그아웃·인증 변경·연결 실패·앱 종료에는 기존대로 스트림을 해제한다.
기존 영상 추론 element와 canvas ref는 작은 창으로 옮기지 않는다.

다른 앱 위 표시는 Electron의 `frame:false`, `alwaysOnTop:true` 자식 창을 사용한다. Main process는 카메라가 켜진
메인 renderer에서 고정 이름 `posegood-camera`와 `about:blank`만 허용한다. 자식 창은 새 탐색·팝업을 막고
메인 renderer만 창 표시·접기·복귀 IPC를 사용할 수 있다. React portal로 기존 스트림과 상태·조작을 공유한다.
주소·OS 제목 표시줄 없이 상태 막대를 항상 표시하고 36px 버튼·드래그 영역을 구분한다. `작은 창 열기` 버튼을 제공하며
메인 창 blur/minimize 때도 자동 요청한다. 자동 표시는 showInactive로 포커스를 가져오지 않는다.
카메라 종료·스트림 교체·메인 페이지 새로고침·앱 종료 시 창과 구독을 정리한다. 메인 renderer는 최소화 중에도
카메라 처리가 이어지도록 backgroundThrottling을 끈다. 웹 영상에는 disablePictureInPicture를 지정한다.

작은 창 닫기는 카메라 종료와 다르다. 카메라 종료/재연결은 기존 창과 늦게 완료되는 이전 창 요청을 정리한다.
원래 앱 문서가 종료되면 작은 창도 끝난다. 다른 사이트는 새 탭으로 열고 앱 탭을 남겨 두어야 한다.
영상/음성 저장·전송, 새 getUserMedia, 카메라 자동 연결은 추가하지 않는다.

## 유지하는 연구 경계

미리보기 창은 촬영 데이터의 정상 수집을 보장하지 않는다. 수집은 기존대로 화면·탭 이동/카메라 단절 시 중단한다.
저품질/누락을 정상으로 채우지 않고 3/2/60 정책·개인 기준·CSV v2·서버 계약을 유지한다.

## 근거와 한계

[Chrome Document PiP](https://developer.chrome.com/docs/web-platform/document-picture-in-picture),
[Chrome 자동 PiP](https://developer.chrome.com/blog/automatic-picture-in-picture)를 확인했다.
2026-10-26에는 [Electron 창 생성 공식 안내](https://www.electronjs.org/docs/latest/api/window-open)를 기준으로
native 자식 창으로 전환했다. 실제 Electron·합성 영상으로 열기/접기/복원/닫기/재열기/카메라 종료를 검증한다.
실제 카메라·장시간 백그라운드 처리·다중 모니터·macOS/Linux 동작은 별도 장치 검증이다.
