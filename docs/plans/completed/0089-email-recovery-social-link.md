# 이메일 인증·비밀번호 찾기·소셜 계정 연결

- 상태: completed
- 담당: FE/BE
- 시작일: 2026-11-16
- 관련 요구사항/ADR: 사용자 요청, ADR 0020·0031, 계획 0088

## 문제와 완료 기준

비밀번호 찾기는 이메일 링크 확인 뒤 재설정 화면에서 새 비밀번호를 두 번 받는다. 서버는 기존 비밀번호 재사용을 거절한다.
일반 회원가입은 서버가 보낸 이메일 코드를 확인하고 같은 이메일의 인증을 한 번 소비한다.
Discord 이메일 중복은 기존 계정 인증과 최종 연결 승인을 거쳐 로그인한다. 첨부 HTML은 UX 참고 자료다.

## 범위와 제외

FE/BE 계정 API와 SMTP 연결, 계약·운영 안내. 발송 업체의 SMTP를 기존 JavaMailSender 어댑터로 호출한다.
단일 API 인스턴스의 짧은 가입·소셜 연결 대기는 서버 메모리에만 보관하며 재시작 시 재인증한다.
운영 비밀 설정·배포·새 소셜 제공자 구현은 포함하지 않는다.

## 작업 단계

- [x] 최신 develop 및 지침·기존 구현 확인
- [x] 구현 및 실패 경로 시험
- [x] 계약·인계·개발 상태 갱신
- [x] 전체 check·lint·가능한 MySQL/브라우저 검증 결과 기록

## 결정과 진행 기록

- 재설정은 기존 32바이트 일회용 링크를 재사용한다. 가입은 6자리 코드, 15분 만료, 최대 5회 시도, 주소당 60초 재전송 제한이다.
- 가입 인증과 소셜 충돌 대기는 HttpOnly 쿠키로 브라우저에 결합한다. 이메일 일치만으로 소셜 계정을 연결하지 않는다.

- 2026-11-16 후속 요청: 인수인계를 ELI5 형식으로 개정했다. 쉬운 사용자 흐름·계정/로그인 수단의 차이·파트별 할 일을 먼저 설명하고, 설정·API 세부는 뒤에 유지했다. 기존 소셜 ELI5 문서도 현재 연결 승인 흐름으로 갱신했다.

## 검증 결과와 남은 한계

- `git fetch --all --prune` 후 develop을 `origin/develop` d9f94609까지 fast-forward하고 `feature/repo-email-recovery-social-link`를 만들었다. 초기 작업 트리는 깨끗했다.
- `python tools/dev.py check` 실행: Python 111개 중 오류 27·건너뜀 10으로 중단. 현재 공용 Python 3.13 환경에 numpy·joblib·torch 등 연구 의존성이 빠져 있다. 변경하지 않은 연구 환경 문제이며 전체 게이트 성공으로 보고하지 않는다.
- 프론트: 첫 `npm run check`의 기존 DeveloperRoute 시험 1개가 기본 병렬 실행에서 5초 시간 초과. `npm exec -- vitest run --maxWorkers=2` 최종 130개 파일·1,032개 시험 통과. Node 시험 8개, TypeScript·Vite 빌드 통과. 기존 500kB 번들 경고는 남는다.
- `npm run lint`: 오류 0·경고 0. 기존 hook 경고 7개도 구독 함수/콜백 의존성과 cleanup 참조를 명확히 해 정리했다. 관련 회귀 36개를 별도로 통과했다.
- `python tools/dev.py check-backend`: 최종 API 116개·processing 62개 통과, MySQL 전용 15개 건너뜀. 기본 시험·Checkstyle·JAR 빌드 통과. JDK 21 Checkstyle main(API/processing)과 API test를 실행했다. 변경 Java 파일 위반은 0이며 변경하지 않은 파일의 CRLF 경고는 남는다.
- 별도 소유 임시 MySQL 8을 loopback 임의 포트에 초기화해 `build -Pmysql-integration` 통과: API 130개(HTTP·쿠키·DB 메일 시험 2개 포함)·processing 62개, 건너뜀 0. 이후 추가한 소셜 실패 경로 단위 시험 1개도 최종 기본 게이트에 포함돼 통과했다.
- MySQL에서 미인증·다른 브라우저·다른 이메일 가입 차단, 증명 1회 소비, 기존 비밀번호 재사용 거절 시 토큰 소비 롤백, 재설정 후 refresh 철회를 확인했다. SMTP 업체만 mock했다.
- `node tools/browser/account-mail.mjs http://127.0.0.1:5178/ <Chrome> .cache/email-browser` 통과. 실제 React 화면에 합성 API 응답을 주입해 가입 인증·코드 오류·재설정·Discord 최종 승인과 자동 로그인, URL 토큰 제거·비밀 미저장·예상 밖 콘솔 오류 0을 확인했다. 라이트/다크와 390/690/1360px 가로 넘침 없음, 캡처를 시각 점검했다.
- 변경 문서 로컬 링크와 `git diff --check` 통과. 임시 MySQL/DB·독립 Chrome 프로필은 종료·삭제했고 시험 Vite도 종료했다. 기존 MySQL 서비스와 공용 .git/.venv는 유지했다.
- 실제 SMTP 수신, 외부 Discord OAuth, 운영 배포는 미검증이다. 활성화는 서버 SMTP와 FE/BE 플래그 설정이 필요하다. 가입/소셜 대기는 단일 API 메모리라 재시작 시 재인증하며 다중 인스턴스 확장 때 공유 저장소로 바꿔야 한다.
