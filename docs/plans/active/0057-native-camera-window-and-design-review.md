# 주소 없는 앱 카메라 창과 시각 디자인 검토

- 상태: in_progress
- 담당: Codex
- 시작일: 2026-10-26
- 관련 요구사항/ADR: 사용자 요청, [ADR 0017](../../decisions/0017-desktop-app-shell-and-redesign.md)

## 문제와 완료 기준

Electron 앱의 작은 창을 브라우저 PiP 대신 frame 없는 native BrowserWindow로 연다. 주소 표시 없이 기존 스트림과 상태·조작을 공유하고 웹은 계속 비활성화한다. 색상·레이아웃의 재디자인 필요 여부는 실제 화면과 비교 시안으로 판단한다.

## 범위와 제외

Electron 창 정책·preload·React 작은 창·검증·디자인 검토 문서. 카메라 재요청·서버 계약·판정·저장 형식은 바꾸지 않는다. 전체 화면의 새 디자인 적용은 이번 검토와 분리한다.

## 작업 단계

- [x] 관련 문서와 현재 구현 확인
- [x] native 작은 창 구현 및 웹 차단·창 종료·중복 방지 검증
- [x] 주요 화면과 색상·레이아웃 비교 검토
- [x] 문서 갱신·프론트와 Electron 검증·결과 기록
- [ ] Docker를 준비한 환경에서 전체 `check-browser` 통과 확인

## 결정과 진행 기록

같은 origin의 about:blank 자식 창에 React portal과 기존 MediaStream을 사용한다. main process가 크기·frame·alwaysOnTop·허용 URL을 결정한다. 임의 팝업·새 카메라 점유·브라우저 PiP fallback은 허용하지 않는다.

색상·레이아웃은 [시각 디자인 검토](../../audits/2026-10-26-visual-design-review.md)에 기록했다. 브랜드 주황 유지·중립 바탕·상태색 역할 분리·측정/기록 배치 재설계를 권한다. 전체 화면 변경은 아직 적용하지 않았다.

## 검증 결과와 남은 한계

- `python tools/dev.py check-frontend`: 54파일·353테스트, TypeScript·Vite 빌드 통과. 기존 번들 크기 경고 유지.
- `node frontend/scripts/smoke-camera-window.mjs http://127.0.0.1:5191`: 실제 개발 Electron·독립 프로필·합성 스트림에서 native 창 열기, 스트림 공유, 브라우저 PiP 미사용, 외부 팝업 차단, 단일 창, 접기/크기 복원, 닫기/재열기, 카메라 종료 정리 통과.
- native 창 정책 테스트에서 허용 URL/발신자, blur/minimize 요청, reload/종료 정리와 접기 크기를 검증했다. 실제 OS 최소화·다중 모니터·장시간 실제 카메라·macOS/Linux는 미검증.
- 웹의 기존 별도 카메라 검사 7개를 같은 구현에서 다시 실행해 웹 PiP 차단과 카메라 생명주기를 확인했다.
- 비교 시안의 측정/기록/설정 전환·작은 창 표시 전환·390px 가로 넘침을 Chrome에서 확인했다. 시안은 기능이 연결되지 않은 비교용이다.
- `python tools/dev.py check-browser`: Docker daemon이 없어 임시 MySQL 생성 단계 실패. 준비된 환경에서 전체 게이트를 다시 실행해야 하므로 계획은 활성 상태로 둔다.
- 패키징 EXE 생성·배포는 하지 않았다.
