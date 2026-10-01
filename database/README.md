# MySQL 저장소

사용자 결정으로 MySQL 8.4 LTS를 사용한다. [ADR 0014](../docs/decisions/0014-mysql-persistence-and-accounts.md),
[계정 API](../contracts/accounts.v1.md), [Compose 실행·배포](../infra/README.md)를 함께 확인한다.

Flyway가 API 영구 모드 시작 시 [V1 마이그레이션](migrations/V1__accounts_and_durable_sessions.sql)을 적용한다.
SQL은 API JAR의 `db/migration`에 포함된다. 적용된 파일을 수정하지 않고 다음 번호로 새 마이그레이션을 추가한다.
Flyway clean은 비활성화한다. DB 연결 실패나 마이그레이션 실패를 메모리 저장으로 우회하지 않는다.

| 테이블 | 목적 |
| --- | --- |
| `users`, `workspaces` | 이메일·비밀번호 hash·프로필·보관 동의 버전·설정 |
| `SPRING_SESSION`, `SPRING_SESSION_ATTRIBUTES` | 만료되는 서버 로그인·CSRF 상태 |
| `measurement_sessions` | 사용자 소유 측정·고정 policy·시각·기준/모델 ID·마지막 확인 요약 |
| `input_results`, `cep_outbox` | 원 관측·요청 hash·처리 상태·내구 전달 |
| `session_events`, `confirmed_snapshots` | 원래 사건과 확인 요약의 SHA-256 증명·작은 메타데이터 |
| `records` | 소유자별 완료 또는 종료 미확인 기록 |
| `cep_cleanup` | 측정 삭제 후 내부 CEP 정리 재시도 |

영상·랜드마크·원본 특징 변화량·비밀번호 원문은 이 DB에 저장하지 않는다.
계정 삭제의 외래키 cascade와 CEP 정리는 서비스 자료의 범위를 다룬다. 로그·외부 파일·백업의
보존/삭제 기간은 운영 정책으로 확정해야 한다. 현재 자동 보존 기간을 임의로 적용하지 않는다.

사건은 새로 추가된 부분만 저장하고 확인 증명에 전체 사건 배열을 반복 저장하지 않는다.
현재 전체 조회 snapshot과 원 관측은 따로 유지하여 재생하고 보관 요청의 원본을 검증한다.
공개 조회는 전체 사건 이력을 포함하므로 긴 세션의 응답/재생 비용과 개발 관측 한도는 여전히 별도 성능 검증 대상이다.

## 검증과 복구

`make check-compose`가 임의 이름의 Compose 프로젝트와 loopback 임시 DB 포트를 만든다.
실제 MySQL에서 마이그레이션과 인증·소유권·중복·장애 복구·삭제를 시험하고 해당 시험 볼륨만 정리한다.
Maven의 `mysql-integration` 프로필은 URL·사용자·비밀번호와 disposable/synthetic 표시가 없으면 실패한다.
H2나 mock 저장소로 실제 MySQL 검증을 대신하지 않는다. 전체 `make check`와 CI에도 연결된다.

새 마이그레이션의 데이터 호환성을 먼저 검토하고 배포 직전에 일관된 백업을 생성한다.
이미지 rollback은 DB schema rollback과 다르다. 기존 볼륨을 삭제하거나 Flyway 이력을 바꾸지 않는다.
백업을 별도 빈 DB에 복원해 확인한 뒤 전환한다. [운영 명령과 제한](../infra/README.md)을 따른다.
