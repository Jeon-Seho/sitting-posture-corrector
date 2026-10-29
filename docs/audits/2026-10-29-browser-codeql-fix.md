# 테마 브라우저 검사 CodeQL 경고 수정

대상: `tools/browser/appearance.mjs`, CodeQL `js/bad-code-sanitization` 알림 #3.
PR #76 병합 뒤 develop에서도 `fill()`의 코드 문자열 조립이 남아 있었다.
앞선 자동 수정은 `click()` 문자열만 보완했으며 실제 인수 전달 구조는 유지했다.

## 변경

`Cdp.invoke()`가 고정 함수 본문과 인수를 `Runtime.callFunctionOn`의 서로 다른 필드로 전달한다.
입력 이름·값, 버튼 문구, 팔레트 ID를 실행 코드에 끼워 넣지 않는다.
요소 검색도 전달값을 DOM 속성/텍스트와 비교하므로 임의 선택자 해석이 없다.
매 호출의 현재 global object 핸들은 완료·실패 후 해제한다. 기존 고정 표현식 검사는 유지한다.

## 검증

- 독립 Chrome 테마 회귀 통과: 코드 모양 인수의 입력 보존과 실행 방지, 없는 요소의 오류 반환,
  7종 팔레트·적응형 로고·차트 대비·시스템/그레이 모드·재로딩·모바일 폭·초기화.
- `check-repo`, Node 문법 검사, `git diff --check` 통과.
- 앱 제품 코드는 바꾸지 않았으며 앱 재패키징·프론트 전체 검사·Docker 전체 회귀는 반복하지 않았다.
- 원격 CodeQL 결과는 후속 PR에서 확인한다. develop의 알림 해소는 수정 병합 후 develop 분석과 구분한다.
