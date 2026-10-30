# 품질 기준

검증은 변경한 경계에 맞춰 선택한다. 실행한 명령과 결과만 보고하며, 부분 검증을 전체 성공으로 쓰지 않는다.

## 범위별 검증

| 변경 범위 | 필요한 검증 |
| --- | --- |
| 읽기 전용 조사 | 요청에 필요한 조회·분석. 테스트 실행은 필수가 아니다 |
| 문서·작업 규칙만 | `git diff --check`와 변경한 로컬 링크의 대상 확인 |
| 프론트 내부 | `make check-frontend`; 테마·레이아웃은 수동 테마 점검, 인증 연결은 수동 JWT 점검 |
| API·판정 엔진 | `make check-backend`; 저장·연결 변경은 명시적 MySQL 통합과 해당 수동 점검 |
| Python·연구 도구 내부 | `make test`와 해당 합성 CLI 검증 |
| 계약·DB·CI·여러 컴포넌트 경계 | `make check` 전체 |

전체 게이트가 통과했다면 새 변경·실패·남은 우려가 없는 한 포함된 검증을 다시 실행하지 않는다.

## 실행되는 게이트

| 게이트 | 명령 | 실패 조건 |
| --- | --- | --- |
| 출력 계약·자료 준비·추론 | `make test` | 남은 합성 계약·추론·인증·연구 분할/품질 경계·배포 보호 테스트 실패 |
| 프론트 | `make check-frontend` | 품질·상태 전이·저장·알림 테스트, TypeScript 또는 빌드 실패 |
| API·처리 서비스 | `make check-backend` | 기본 Java 시험·Checkstyle·빌드 실패. MySQL 통합 시험은 별도 실행 |

`make check`와 `check-local`은 위 세 게이트를 같은 순서로 실행한다. 기본 검사에는 MySQL·Chrome·Docker·Compose가 필요하지 않다.
Python 3.9+, Node.js 24+, 컴파일·시험용 JDK 17과 Checkstyle용 JDK 21이 필요하다. 준비 방법은 [개발 흐름](development.md)을 따른다.
구형 저장소 검사·종합 브라우저/Compose 검사·서버 benchmark는 2026-10-29 제거했다. 삭제한 단계를 성공 stub으로 남기지 않는다.

수동/reusable harness는 `make check`를 실행하며 배포 전 검증도 이 범위를 따른다. 기본 검사 성공은 실제 DB·브라우저·배포 연결 성공을 뜻하지 않는다.
별도 FE PR CI는 `typecheck`·`lint`, BE PR CI는 컴파일·`checkstyleMain`을 실행한다. `npm run check`에는 lint가 포함되지 않는다. DB CI는 별도로 유지한다.
원격 CI 실행·브랜치 보호는 로컬 검증과 구분한다.

## 명시적으로 실행하는 검증

- MySQL 통합: 시험 loopback 서버와 `POSEGOOD_TEST_MYSQL_URL`·`_USER`·`_PASSWORD`를 준비하고 `backend/gradlew -p backend build -Pmysql-integration`을 실행한다. Windows는 `backend\gradlew.bat`이다. 시험 DB 생성·삭제 권한과 방법은 [백엔드](../backend/README.md#준비와-검증)를 따른다.
- 테마: `node tools/browser/appearance.mjs <프론트 URL> "<Chrome 실행 파일>" "<캡처 디렉터리>"`. Vite·Chrome에서 대표 라이트/다크·이미지·사용자 색상·복원·좁은 화면을 확인한다.
- JWT: `node tools/browser/jwt-integration.mjs <프론트 URL> "<Chrome 실행 파일>"`. 인증 연결 변경 시 테스트 API·DB·Vite·Chrome과 합성 계정을 사용한다.
- 자정 브라우저: 시험 API·DB와 연결한 `browser-smoke` 모드 Vite, 합성 시험 계정, Chrome을 준비하고 `node tools/browser/midnight.mjs <Vite URL> "<Chrome 실행 파일>" "<캡처 디렉터리>"`를 실행한다([준비](../frontend/README.md#시각-스타일과-자정-측정2026-10-26)). 계정은 `POSEGOOD_MIDNIGHT_EMAIL`·`POSEGOOD_MIDNIGHT_PASSWORD`로 지정한다. 서버 시작 시각이 KST 자정 전 10초 이내인 환경에서 실제 REST/WS·R1 기록 조회와 합성 카메라를 사용해 등록·측정·자정 전후 카메라 유지·날짜별 로컬 보관·오늘/달력 표시를 확인한다. 서버의 자정 세션 전환은 별도 검증이며 날짜별 계산 단위 테스트는 기존 FE 검사에 포함된다.
- 변경한 개발 실행은 시험용 MySQL·빌드된 API JAR로 `python tools/dev.py dev-server`의 준비·프록시 접근·종료를 확인한다.

수동 점검을 기본 `check`·`setup`·CI에 자동 연결하지 않는다. 필요한 실행 환경이 없거나 기존 문제로 실패하면 항목·원인과 미검증 범위를 기록한다. 보존한 플랫폼 도구의 기존 API 불일치를 이번 정리에서 고치지 않는다.

## 검증 경계와 수용 기준

- 삭제한 수집 미리보기 검사의 화면 폭별 배치·실제 Chrome 영상 스트림 연결/종료와 Compose 종합 검사의 컨테이너 재생성 후 자료 보존·제공 자산 해시·실제 백업 복원은 현재 기본 자동 검사에서 확인하지 않는다. 필요할 때 시험 환경에서 해당 동작을 별도로 확인하고 결과를 남긴다. FE 컴포넌트 시험이나 배포 보호 단위 시험이 이 실행 검증을 대신하지 않는다.
- `console-policy.mjs`의 예상 진단 분류·응답/로그 개수 대조 로직은 FE의 Node 단위 시험에 포함된다. 실제 Chrome에서 수집한 개수의 최종 대조 호출은 종합 브라우저 검사와 함께 제거했으며, 개별 브라우저 점검의 콘솔 오류 확인과 구분한다.
- fixture는 명시적인 합성 자료다. 브라우저는 독립 임시 프로필과 개발 serve 전용 합성 카메라를 사용하며 실제 getUserMedia를 거부한다. preview·생산 번들에는 이 모드를 활성화하지 않는다.
- DB·브라우저 수동 실행은 시험 서버·합성 계정과 독립 임시 프로필을 사용한다. 운영 DB·실제 영상·참여자 자료에는 접근하지 않는다. 자신이 시작한 프로세스와 시험 DB의 종료·회수 여부를 기록한다.
- 측정 불가·등록 전·카메라 재연결을 정상/이탈로 오인하지 않는다. 일시 동작·지속 이탈·누락·재등록의 합성 상태 전이와 타임스탬프 역전/간격 급증을 검증한다.
- 생산자·소비자는 동일한 합성 계약 fixture로 검증한다. 저장 손상 원본, 재시도 ID/시각, 타 세션 자료, 미확인 종료와 원래 서버 사건·통계를 보존한다.
- 연구 기준은 [프로토콜](research/protocol.md), 자료 준비는 [규격](research/dataset-preparation.md), 개인 학습은 [개인 실험](research/personal-pilot-training.md)을 따른다. 개인 창별 성능을 새 참여자·실생활 정확도로 보고하지 않는다.
- 실제 FPS·지연·음향·장시간 동작은 장치/해상도/환경을 기록한 별도 측정 대상이다. [측정·해석](removed-docs.md)

기존 Mac 회귀와 확인창·수집 창·서버 흐름의 검증 기록은 [감사](removed-docs.md)와 [완료 계획](plans/completed/)에 남긴다.
변경한 문서의 링크와 산출물 범위는 일회성으로 확인한다. 새 상시 문서 검사기나 정확한 파일 수 assertion을 추가하지 않는다.

## 결과 보고

관련해 실행한 명령·성공/실패, 테스트 수, 타입/빌드 및 HTTP·브라우저·DB 결과를 기록한다.
전체 게이트 대상 작업은 `make check` 실행 여부와 중요한 미검증 사항을 명시한다. 실행하지 않은 검증을 통과했다고 쓰지 않는다.
읽기 전용·문서 작업에는 관련 없는 언어별 테스트 수를 강제하지 않는다. 원격 CI·실제 장치 결과는 합성 로컬 결과와 구분한다.
