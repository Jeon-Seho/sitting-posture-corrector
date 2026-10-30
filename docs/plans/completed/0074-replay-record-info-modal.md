# 리플레이 선택 버튼과 기록 정보 모달

- 상태: completed
- 담당: Codex
- 시작일: 2026-10-27
- 관련 요구사항/ADR: 최신 사용자 주석, [관측 UI](../../design/developer-lab.md)

## 문제와 완료 기준

속도·좌표 선택 버튼의 테두리만 제거하고 옵션 목록 테두리는 유지한다.
드물게 여는 기록 정보는 동그라미 느낌표 아이콘으로 표시하고 클릭하면 모달로 연다.
키보드 접근·Escape 닫기·초점 복귀를 유지한다.

## 범위와 제외

리플레이 설정 UI만 변경한다. 실제 메모리 기록과 JSON 형식·지표 계산은 유지한다.

## 작업 단계

- [x] 공통 모달 초점 도구와 현재 설정 확인, 기존 Git 경로 오류 확인
- [x] 모달·선택 버튼 스타일 구현
- [x] 합성 테스트·타입·빌드·실제 브라우저 검수
- [x] 문서 동기화

## 구현

두 트리거는 border 0, 옵션 목록은 기존 1px 테두리다. 공통 modalFocus의 native showModal·Tab 순환·
초점 복귀를 재사용하고 닫기 버튼 하나를 둔다. 모달 Escape는 부모 설정까지 전파하지 않는다.
열 때 재생을 멈추며 긴 내용에는 ObservationScrollPanel을 재사용한다. 부모의 기록 훅 순서는 유지한다.

## 검증 결과와 남은 한계

- `make check-frontend`: 105파일·862테스트 및 TypeScript/Vite 빌드 통과. 기존 청크 경고 유지.
- 합성 테스트로 아이콘·모달 열기/닫기·읽기 전용 정보·Escape 전파 차단을 확인했다.
- 실제 `/dev`에서 트리거 두 개 border=0px, 펼친 목록 border=1px 확인.
- native :modal·닫기 초기 초점·Tab 내부 유지·Escape 닫기·느낌표 아이콘 초점 복귀·부모 설정 유지 확인.
- 데스크톱 및 390×844에서 가로 넘침 없음, 최종 console warn/error 0건.
- 현재 3분21.2초 기록과 재생 위치 유지, 새 실제 측정이나 외부 저장/업로드 없음. 뷰포트 override 해제.
- 캡처 `/private/tmp/replay-select-no-border.jpg`, `/private/tmp/replay-record-info-detail.jpg`.
- `make check-repo`는 기존 Git 메타데이터 경로 오류로 실패. 수정 문서 링크·필수 경로·공백은 부분 검사했다.
  전체 서버/DB·별도 전체 브라우저 게이트는 미실행이다.
