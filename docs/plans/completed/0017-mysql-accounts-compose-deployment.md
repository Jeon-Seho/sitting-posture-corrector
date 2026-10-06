# MySQL 계정·영구 저장·Compose와 배포 자동화

- 분야: 백엔드
- 작업: GP-0109
- 상태: completed
- 담당: Codex
- 시작일: 2026-10-01
- 완료일: 2026-10-01
- 관련 요구사항/ADR: [DB·인증 설계](../../design/server-persistence-and-auth.md), [시간 정책](../../decisions/0012-session-timing-policy.md), [서버 연결](../../decisions/0013-frontend-server-feature-connection.md)

## 문제와 완료 기준

사용자가 남은 DB 작업 전체를 구현하고 Docker Compose로 즉시 실행하며 GitHub Actions 자동 배포를 준비하도록 요청했다.
DB는 **MySQL**, 로그인은 **이메일·비밀번호**로 사용자 확인했다. 배포 서버는 아직 정해지지 않았으므로 로컬 실행과 배포 설정까지 진행한다.

- MySQL 마이그레이션, 사용자·세션 소유권, DB 세션 인증·CSRF, 프로필·설정·기록의 영구 저장과 삭제를 실제 구현한다.
- 처리 전 내구 저장·같은 요청 재전달·API/CEP 재시작 복구를 기존 3/2/60 정책과 함께 검증한다.
- Compose로 DB·API·CEP·추론·프론트를 실행하고 내부 서비스 인증·건강 검사·볼륨·비밀값 주입을 확인한다.
- GitHub Actions에서 검증 후 불변 이미지 식별자로 빌드/게시하고, 설정된 환경에 SSH 배포하도록 구성한다.
- 빅데이터 플랫폼에서 담당할 수집/전달/분석 경계와 이 저장소의 producer 책임을 문서와 계약으로 분리한다.
- 합성 자료로 인증·소유권·중복·장애·복구·삭제·마이그레이션 및 프론트/브라우저 회귀를 실행하고 게이트에 연결한다.

## 범위와 제외

API/DB 영구 모드, CEP 내부 보호·재생, 계정용 프론트 연결, Docker/Compose, 배포·백업/복구 도구와 CI를 변경한다.
기존 로컬 프로토타입·메모리 개발 모드는 유지하고 계정 모드에서 명시적으로 DB 저장과 인증을 활성화한다.
실제 영상·원본 좌표·특징 변화량 원문·비밀번호 원문을 영구 저장하지 않는다. 시험에는 명시적 합성 자료만 쓴다.

실제 배포 대상/도메인/접속 키가 없으므로 외부 배포와 GitHub 환경/Secrets 등록은 실행하지 않는다.
Kafka·Redis·HDFS·Spark 자체 클러스터, 실제 연구 자료 수집·학습·의학적 효과 검증은 이번 구현 범위에서 확정하지 않는다.
법적 동의/보관 기간을 추정하지 않고 연구 활용은 별도 승인/계약이 필요하다. 사용자 임시 문서는 보존한다.

## 작업 단계

- [x] 현재 요청·문서·변경 상태·컴포넌트 규칙 확인
- [x] 사용자 DB/로그인/배포 환경 확인
- [x] MySQL 스키마·마이그레이션·인증·소유권·영구 저장
- [x] 내구 처리·CEP 재전달/복구·삭제 검증
- [x] 프론트 계정·프로필/설정/기록 연결·계정별 임시 저장 격리
- [x] Docker Compose·비밀값·건강 검사·백업/복구·배포 도구
- [x] GitHub Actions 검증·이미지 게시·환경 배포 설정
- [x] 빅데이터 producer/분석 경계 계약·문서
- [x] 교차 검토·오류 수정·관련 문서/게이트 동기화
- [x] `make check`와 실제 MySQL/Compose 통합 검증

## 결정과 진행 기록

- 기존 Java 21·Spring Boot·Esper·FastAPI·React/Vite를 유지한다. MySQL·JDBC/Flyway·서버 인증은 이번 사용자 요청으로 추가한다.
- 배포 대상은 미정이다. 로컬 Compose를 먼저 검증하고 자동 배포는 명시적 환경 변수/Secrets와 배포 환경으로 연결한다.
- 기본 프로토타입 검증과 계정/컨테이너 검증을 분리하되 실제 컴포넌트 검증을 CI에 포함한다.
- Docker Desktop이 설치돼 있으나 daemon은 처음에 꺼져 있었다. Compose 검증을 위해 시작하며 다른 프로젝트 자원을 변경하지 않는다.
- 이 Mac의 Desktop secret bind가 대기하는 문제를 합성 파일의 외부 임시 경로 대조로 확인했다. OS 권한 변경 없이 시험 secret만 private 시스템 임시 폴더로 옮겼고 일반 실행의 외부 지속 경로를 안내했다.
- 실제 실행에서 API 재생성 후 Nginx의 이전 IP 사용을 발견하여 Docker DNS 재해석을 적용했다. 검증 overlay DB는 추가 bridge와 실제 Engine loopback binding을 검사해 임시 호스트 연결을 제공한다.
- 리뷰에서 비밀번호 변경/늦은 로그인 경쟁, 잠금 대기 409의 확정 거부 오해, 빈 확인 요약 보관 모델 충돌, 같은 SHA 재배포의 previous manifest 덮어쓰기와 종료된 프로세스의 잔여 락을 수정했다.
- 최종 리뷰로 늦은 프론트 인증 응답과 ACK/사건 중복 저장 비용을 보완한 뒤 전체 게이트를 재실행한다.

## 검증 결과와 남은 한계

2026-10-01 현재 Mac 작업 폴더에서 최신 코드의 **`make check` 전체 exit 0**.
로그는 Git 제외 `.cache/mysql-final-make-check.log`다. Java 21은 캐시한 Corretto,
Maven 3.9.16은 저장소 도구 경로로 지정했으며 모든 Maven 게이트는 저장소 settings와 전용 캐시를 사용했다.

| 검증 | 실제 결과 |
| --- | --- |
| 저장소·Markdown 링크·Git diff 공백 | 통과 |
| Python 3.9 합성 계약/추론/자료 준비/도구 | 122개 통과 |
| 프론트 Vitest | 27파일·228개 통과 |
| TypeScript·Vite·MediaPipe 자산 | 통과, 기본/계정 모드 생산 빌드 확인 |
| 기본 Java API/CEP | 69개 활성 테스트 통과(API 45/CEP 24), 실행 JAR 생성 |
| 메모리 실제 HTTP·합성 benchmark·정리 | 통과 |
| 기존 실제 Chrome 합성 회귀 | 61개 통과 |
| Compose | 네 앱 이미지 빌드·DB 포함 다섯 서비스 Healthy, 46개 검사 통과 |
| Compose 실제 계정 Chrome | 21개 통과(46개에 포함), 카메라 권한 호출 0 |
| 실제 MySQL 전용 테스트 | 원본 DB 11개 + 복원 DB 11개, 실패/오류/skip 0 |
| 백업 복원 | 합성 dump→별도 빈 MySQL, 모든 테이블 row count 일치·같은 볼륨 재마운트·Flyway validate 통과 |
| 자원 정리 | 두 시험 프로젝트의 컨테이너·네트워크·볼륨·프론트/DB 포트 및 시험 Chrome/서버 종료 확인 |

기본 Java 프로필에서는 MySQL 전용 테스트를 실행하지 않는다. 전체 게이트 뒤쪽의 필수
`mysql-integration` 두 실행에서 실제 DB에 연결하여 skip 없이 확인한다.
DB 없는 mock/H2 테스트로 영구 모드 완료를 대신하지 않았다.

최종 리뷰로 ACK 증빙의 전체 사건 배열 중복 저장과 기존 사건 반복 SQL을 제거했다.
canonical typed SHA256·작은 메타데이터 증빙과 새 사건 suffix만 저장하며, 변조 거부·기존 full-view 증빙 호환을 검증했다.
현재 전체 snapshot/응답과 prefix 비교·해시 계산의 사건 배열 비용은 남으므로 전체 처리 비용이 선형이라고 주장하지 않는다.

배포 도구는 호스트키·digest/경로·비밀값·중복 배포/manifest·backup 실패·빈 DB restore·실제 loopback binding·
Maven 설정에 관한 회귀를 포함한다. 원격 GitHub workflow/두 플랫폼 이미지 게시/SSH 배포는 실행하지 않았다.
사용자가 서버·도메인·키를 정하지 않아 production Variables/Secrets와 TLS/호스트 준비는 남는다.
운영 보존/백업 만료·이메일 확인/분실 복구·기기 간 활성 측정 검색·영구 개인 기준,
실제 카메라/음향/장시간/FPS·학습 정확도·연구 동의/수집은 이번 검증에 포함하지 않는다.
Windows 및 실제 배포 호스트 실행은 미검증이며 Linux 컨테이너는 현재 Mac Docker에서 검증했다.
Kafka/CDC 분석 export·Spark/HDFS 클러스터와 학습은 [플랫폼 경계](../../design/data-platform-boundary.md)의 별도 작업이다.
사용자 임시 `docs/references/temp.md`는 변경하지 않았다. 위 검증 시점에는 아직 remote push하지 않았다.
