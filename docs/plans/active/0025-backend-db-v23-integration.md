# 백엔드·프론트·DB V2.3 연동

- 상태: in_progress
- 담당: Codex (사용자 요청, feature/repo-backend-db-v2)
- 시작일: 2026-10-13
- 관련 요구사항/ADR: [DB V2.3](../../../database/README.md), [API 판정 경계](../../decisions/0020-single-api-decision-engine.md), [FE 연동](../../design/fe-server-proposal.md)

## 문제와 완료 기준

develop 병합 뒤 DB는 V2.3이지만 백엔드는 삭제된 컬럼 13개와 옛 기준 자세 모델을 사용한다.
V2.3 스키마·시드로 기동하고 가입·설정·기준 등록·측정·종료·기록 조회가 실제 MySQL에서 동작해야 한다.
프론트가 등록한 기준을 서버에 저장·다시 조회하고, 항목별 동의와 선택 프로필을 DB 계약대로 처리해야 한다.

## 범위와 제외

백엔드 저장 계층·HTTP/실시간 계약, 필요한 프론트 어댑터와 가입/프로필 흐름, 초기화·검증 도구와 문서를 변경한다.
DB V2.3 테이블 구조는 유지한다. 학습 모델·HDFS 적재·운영 배포는 포함하지 않는다.
사용자 답변에 따라 현재 특징 v2 API를 유지한다. 좌표 스트림 v3·Kafka 전환은 별도 범위다.
구현 결정은 [ADR 0022](../../decisions/0022-db-v23-feature-v2-integration.md)와 [계정 API v2](../../../contracts/accounts.v2.md)에 기록했다.

## 작업 단계

- [x] 현재 소스·DB·프론트 계약과 불일치 확인
- [x] 정책·계정·기준·세션·사건·통계 SQL을 V2.3에 맞춤
- [x] 항목별 동의·선택 프로필·독립 기준 등록 및 조회 API
- [x] 프론트 연결과 계약 버전 갱신
- [x] 초기화·통합시험·smoke 갱신
- [ ] 문서·계약 동기화 및 전체 게이트 검증

## 결정과 진행 기록

- DB 스키마·기존 확정 임계값은 변경하지 않는다. 프론트의 `alerts_on`은 DB가 세션 알림 원본으로 정의한 `sound_alert_enabled`에 대응한다. 브라우저 소리 재생 허용은 계속 기기 상태다.
- 변경되는 계정·저장/기준 API는 v2로 명시한다. 특징·관측·판정의 기존 JSON 스키마는 재사용한다.

- 2026-10-13 develop(#41 `frontend_jin`) 병합: develop은 기준 자세를 이 PC(localStorage)에 저장해 다음 측정에 쓰고, 이 브랜치는 계정 DB에 저장한다.
  계정 앱은 DB 기준만 쓰고 PC 저장을 읽거나 쓰지 않는다(남은 PC 기준이 계정 기준을 가리지 않게). 계정 없는 로컬 앱은 develop대로 PC에 저장한다.
  develop의 「등록 끝나면 바로 측정 시작」은 계정 앱에서 기준이 DB에 저장된 뒤에 시작한다.
  남은 일: develop의 `features/accounts/consents.ts`(화면 미연결, `consent_type`·`terms-2026-10`)와 이 브랜치의 `registrationConsents`(`type`·`service-v2`, API가 받는 형식)를 하나로 합친다.

## 검증 결과와 남은 한계

- `python tools/dev.py check`: 저장소 검사, Python, 프론트, 실제 MySQL·FastAPI, 계정 브라우저 단계 통과. 첫 실행에서 발견한 Windows 백업 실패 시 열린 파일 삭제 오류를 고쳤다. 배포 manifest 시험은 별도로 검증하는 POSIX 잠금을 mock하여 Windows에서도 실행한다.
- Python unittest: 137개 중 136 통과, 1개 제외(Windows에서 symlink 생성 권한 없음). 0 실패.
- 프론트: Vitest 316개 통과, TypeScript·Vite 생산 빌드 통과. 기존 단일 JS chunk 크기 경고는 남음.
- Java: 단위 37개, 실제 MySQL 통합 7개, 합계 44개 통과·0 제외. JDK 21.0.12와 별도 임시 MySQL 8.0 사용.
- FastAPI HTTP smoke: 실제 추론·재시도·접근 제한·DB 행·기록 조회·삭제 6개 확인 통과.
- 계정 브라우저: 합성 카메라로 23개 확인 통과. 가입·설정·독립 기준 저장·측정·새로고침 복구·소유권·비밀번호·탈퇴 포함.
- 마지막 Compose 단계는 최초 Docker daemon 부재로 중단. 설치된 Docker를 시작했으며 `python tools/dev.py check-compose`로 MySQL 8.4·컨테이너·백업 복원을 별도 확인 중.
- 실제 카메라·장기 운용·음향 품질·학습 모델 성능·원격 CI는 이 합성 검증의 대상이 아니다.
- 2026-10-13 커밋 전 재확인(Claude, JDK 21.0.12, IntelliJ 내장 Maven, Docker 임시 MySQL): `check-repo` 통과, `check-frontend` 316개 통과,
  `check-backend` Java 44개(실제 MySQL 통합 포함)·HTTP smoke 6단계 통과, Python unittest 138개 중 137 통과·1 건너뜀.
  `check-compose` 전체는 이번에 다시 실행하지 않았다. 이 PC는 `JAVA_HOME`이 JDK 17이고 `mvn`이 PATH에 없어 `JAVA_HOME`·`MAVEN_EXECUTABLE`을 지정해야 한다.
