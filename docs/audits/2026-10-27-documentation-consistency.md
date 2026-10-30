# 현재 코드와 문서 대조 (2026-10-27)

> **이전 작업 보존본:** 이 문서의 구현·검증 수치·미완료 항목은 6a2f765 기준입니다. 현재 JWT 통합 상태와 실행 지침은 [2026-10-29 인계서](../design/frontend-jwt-handoff-2026-10-29.md)를 따릅니다. 아래 과거 결과를 현재 브랜치의 검증 결과로 해석하지 않습니다.

## 기준과 범위

원격 조회 뒤의 `origin/develop` `2e1fd2b`를 기준으로 루트 안내·제품 범위·아키텍처·코드 지도·개발/배포 안내·계약 안내와 관련 활성 계획을 대조했다.
문서만 갱신했으며 실행 코드·스키마·기존 동의 문서 버전은 바꾸지 않았다. 외부 원문·다른 브랜치·운영 서버의 상태는 확인 범위에 포함하지 않는다.
과거 ADR·감사의 당시 검증 수치는 유지하고 현재 안내에서 과거 사실을 현재 구현으로 읽지 않도록 설명을 추가했다.

후속 프론트 구현은 [쉬운 인계](../design/frontend-handoff-2026-10-27.md)에서 확인한다. 아래 표는 위 기준 커밋의 조사 결과이며, 후속 구현 완료 여부를 대신하지 않는다.

## 확인한 구현과 고친 설명

| 주제 | 코드 근거 | 현재 사실·문서 갱신 |
| --- | --- | --- |
| 앱 진입·인증 | `frontend/src/app/ServiceApp.tsx`, `LocalServiceApp.tsx` | 현재는 로컬 앱. Compose나 `dev-server`의 `VITE_SERVER_ACCOUNTS` 설정만으로 MySQL 계정 앱이 되지 않는다. README·제품·infra·인계 안내 정정 |
| 앱–API 연결 | `frontend/src/features/session/server/client.ts`, `backend/api/.../session/SessionController.java` | 예전 앱 요청은 `/api/v1/sessions`, 서버 REST는 `/v2/sessions`. 개발용 서버 판정을 연결 가능한 현재 기능으로 설명하지 않음 |
| DB 정본 | `database/schema/schema_V2_5.sql`, `backend/api/.../system/SchemaVerifier.java`, `infra/mysql/initdb/10-posegood-schema.sh` | API와 새 Compose 볼륨 기준은 V2.5. 처리 서비스의 V2.3 검사·과거 서버 기록은 별도로 표시. 기존 DB는 마이그레이션 필요 |
| 빌드 | `backend/api/build.gradle`, `infra/docker/java.Dockerfile`, `.github/workflows/harness.yml` | Gradle·Java 17 toolchain, Docker도 Java 17. CI는 Java 21 설치와 Java 17 toolchain의 차이가 남음. Maven 빌드가 남았다는 안내 정정 |
| 실시간 | `backend/api/.../realtime/RealtimeConfiguration.java`, `contracts/realtime/` | API는 WebSocket v2만 제공. v1은 10/26 삭제. Nginx 잔여 설정과 API 지원 여부를 구분 |
| 재전송·시간 | `backend/api/.../engine/SessionEngine.java`, `application.properties` | 최근 120개 구간 재전송 기억, 제품 한도 없음·계약 시각 상한 24시간. 측정불가/자리 비움 5분 자동 종료는 구현됐지만 기본 0(끔). 10,000건·5000초를 현재 한도로 쓰던 안내 정정 |
| 카메라·기준 | `frontend/src/hooks/useCamera.ts`, `features/camera/savedBaseline.ts`, `devices.ts`, 계획 0053 | 카메라 공통 기준 하나를 localStorage에 보관. 640×480 요청, 미지원 크기도 시작 허용. 카메라별 저장·앱 실행 중에만 유지한다는 안내 정정 |
| 기록·화면 | `frontend/src/features/storage/`, `features/history/`, `DESIGN.md` | 기록은 메모리 전용이 아니며 기록·달력은 로컬 자료 조회. 포레스트 테마·밝은 정보 영역 기준으로 제품 소개 갱신 |
| 일별 조회·삭제 | `docs/design/api-spec.md`, `backend/api/.../workspace/WorkspaceController.java`, `account/AccountService.java` | T1·R1b는 구현 전. 최종 탈퇴 삭제는 J3 책임. 현재 API에 최종 삭제가 있는 것처럼 쓴 코드 지도 정정 |
| Kafka·등록 | `backend/inference/`, `backend/processing/`, 계획 0031 | Kafka 처리 코드와 앱 연결 완료는 다름. 추론의 좌표 입력·등록 평균 계산은 후속 설계. v5.2 역할 문서·변경 안내에 해석 기준 추가 |
| 개발 명령 | `tools/dev_tasks.py` | `check-backend`는 단위·MySQL·HTTP smoke. benchmark는 별도 명령. FE 명령의 예전 고정 작업 브랜치 갱신 절차 제거 |

표의 Java 경로 `backend/api/.../`는 `backend/api/src/main/java/org/posegood/api/`를 줄인 것이다.

## 코드 변경·합의가 필요한 잔여 항목

| 항목 | 확인 근거·다음 작업 |
| --- | --- |
| 프론트 계정·실시간 v2 연결 | 로컬 진입점·v1 HTTP 클라이언트를 현행 계약과 연결해야 한다. 계획 0023·0027에 따라 별도 구현·통합 검증 필요 |
| Nginx v1 전달 설정 | `infra/nginx/default.conf`의 `/api/v1/realtime` 블록·주석이 남아 있다. API에서 수용하지 않으므로 설정·관련 회귀 검사를 함께 정리할 것 |
| CI Java 정렬·검사 공백 | `harness.yml`은 Java 21 설치, 빌드 toolchain은 17. `tests/test_service_contracts.py`는 사라진 `pom.xml`만 검색한다. 계획 0028의 미완료 작업 유지 |
| R1 smoke 응답 | `tools/platform/io_api_smoke.py`는 R1을 배열로 읽는다. 현재 응답은 `{today, records}` 객체이므로 수정 후 실제 서버로 검증해야 함 |
| 동의 문구 버전 | `contracts/consent-documents.v2.md`의 `POSE_COORDINATES`는 측정 중 특징 변화량이라고 설명하지만 WebSocket v2는 좌표 구간을 받는다. 이 문서는 내용 변경 시 버전 갱신·새 동의를 요구한다. 기존 `service-v2` 본문을 덮어쓰지 않고 새 문구·버전·앱/BE 동의 처리의 동시 갱신 대상으로 남김 |
| FE 연동 명세의 최신 응답 | `docs/design/api-ws-spec.md` 앞에 현재 서버와의 차이 표를 추가했다. 본문의 과거 예시를 그대로 연결하지 말고 V3 설계와 함께 B1 `registration_id`·최소 20표본(로컬은 15), 서버 시각, R1 객체·`today`를 맞출 것. BE 구현 형식은 `api-spec.md`·`accounts.v2.md`를 우선 확인 |
| Kafka 전환·DB 운영 적용 | 계획 0031의 앱 입구 연결·결과 쓰기 이관·정책 동등성 확인이 남는다. 과거 V2.3 서버 기록만으로 현재 V2.5 적용·배포를 완료 처리하지 않음 |

## 검증과 한계

2026-10-27 문서 작업 검증: `python tools/dev.py check-repo` 통과(저장소 구조·로컬 Markdown 링크·산출물 경로), `git diff --check` 통과(공백 오류 없음).
이번 대조는 소스·설정·문서의 정적 비교다. 프론트/Java 테스트·타입/빌드·MySQL·HTTP·브라우저·Compose 전체 검증과 실제 장치·운영 서버 점검은 실행하지 않는다.
버전이 있는 동의 본문과 외부 원문은 유지했다. 남은 연동 문제를 문서 변경만으로 해결했다고 보고하지 않는다.
