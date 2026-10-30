# ADR 0015: Compose 구성과 빌드·배포 책임

- 상태: accepted
- 날짜: 2026-10-01
- 최신화: 2026-10-30, 현재 저장소의 Compose·Dockerfile·빌드 설정·워크플로·배포 도구 기준
- 근거: Docker Compose 실행과 GitHub Actions 자동 배포 결정, 서버 PC용 플랫폼 분리, FE의 Vercel 분리 배포 결정.
- 관련: [인프라 실행 안내](../../infra/README.md), [FE 배포 결정과 진행 기록](../design/fe-deploy.md),
  [현재 API 판정 구조](0020-single-api-decision-engine.md), [Kafka 전환 계획](../plans/active/0031-realtime-kafka-transition.md).

## 1. 결정과 실행 구성

Compose는 실행할 서비스·네트워크·포트·볼륨·설정 주입·준비 순서를 정의하고, Dockerfile은 각 서비스의 이미지를 만든다.
애플리케이션 빌드는 Gradle·npm·Python 의존성 설정이 담당하며, GitHub Actions와 배포 도구가 검증·게시·호스트 반영을 연결한다.

현재 실행 구성은 다음과 같이 구분한다. 표와 본문의 파일 표기는 저장소 루트 기준이다.

| 구성 | 실제 서비스와 책임 | DB·공개 경로 |
| --- | --- | --- |
| 루트 [compose.yaml](../../compose.yaml) | `db`·`api`·`inference`·`frontend`를 함께 실행한다. 로컬 일괄 실행과 아래 GHCR/SSH 자동 배포가 사용하는 구성이다 | MySQL 컨테이너와 `mysql_data` 볼륨. 기본 공개 포트는 `frontend`의 `127.0.0.1:8080`뿐이다 |
| 서버 PC [infra/compose/bigdata.yaml](../../infra/compose/bigdata.yaml) 기본 구성 | Kafka·Redis·HDFS NameNode/DataNode·Spark·`api-server`·`inference-service`를 실행한다. 프로젝트 이름은 `platform`으로 유지한다 | 외부 MySQL을 사용한다. Kafka·Redis·HDFS 자료는 플랫폼 볼륨에 보관한다. 일부 포트는 LAN에 공개하므로 루트 구성의 내부망 정책과 다르다 |
| 같은 파일의 `io` 프로필 | `io-api`·`inference`·`web`을 추가한다. API와 화면을 서버 PC에서 연결해 시험하는 구성이다 | 외부 MySQL 사용. 기본 `io-api`는 `127.0.0.1:8090`, `web`은 `127.0.0.1:8088`. `inference`는 호스트 포트를 열지 않는다 |
| FE 분리 배포 | [frontend/vercel.json](../../frontend/vercel.json)에 따라 화면을 빌드해 Vercel에 배포한다. FE 배포 문서상 연결 대상은 포크의 `develop`이다 | 화면 `app.posegood.site`와 API `api.posegood.site`를 분리하는 결정이다. GitHub의 루트 Compose 배포와 별도 경로다 |

현재 앱의 측정 경로는 `frontend/web → api/io-api → model/inference`이며 판정은 API 안에서 한다.
`api-server`는 `backend/processing`의 Kafka 판정·결과 저장 서비스이고,
`inference-service`는 `backend/inference`의 Kafka 추론 서비스다. 이름이 비슷한 HTTP `inference`와 실행 코드가 다르다.
별도 CEP 서비스나 CEP 이미지는 사용하지 않는다.

플랫폼의 Kafka 처리 경로가 존재해도 앱의 WebSocket이 그 경로에 연결됐다는 뜻은 아니다.
현재 `io-api` 구성의 `POSEGOOD_REALTIME_PIPELINE=local`과 Kafka·Redis 주소는 전환 준비 설정이며,
현재 API 코드에는 Kafka 전환 분기가 없다. 실제 연결 변경은 [계획 0031](../plans/active/0031-realtime-kafka-transition.md)의 범위다.

루트 구성은 `python tools/compose_init.py` 후 `docker compose up -d --build --wait --wait-timeout 180`으로 실행한다.
플랫폼은 필요한 환경 파일과 비밀 파일을 준비한 뒤 다음처럼 별도 Compose 파일을 선택한다.
`--env-file`은 루트 `.env`와 플랫폼 설정을 혼동하지 않도록 명시한다.

```sh
docker compose --env-file infra/compose/.env -f infra/compose/bigdata.yaml up -d --build
docker compose --env-file infra/compose/.env -f infra/compose/bigdata.yaml --profile io up -d --build
```

Gradle로 Java 앱을 직접 빌드·실행하면 Compose가 자동으로 실행되거나 환경 파일을 읽지는 않는다.

## 2. 빌드 파일의 책임

| 파일 | 책임과 산출물 |
| --- | --- |
| [backend/settings.gradle](../../backend/settings.gradle), [backend/gradlew](../../backend/gradlew), [backend/gradlew.bat](../../backend/gradlew.bat), [backend/gradle/wrapper/gradle-wrapper.properties](../../backend/gradle/wrapper/gradle-wrapper.properties) | `api`·`processing` 멀티 프로젝트와 Gradle 배포본을 정한다. Unix/Windows 진입점은 같은 Wrapper 설정을 사용한다 |
| [backend/api/build.gradle](../../backend/api/build.gradle), [backend/processing/build.gradle](../../backend/processing/build.gradle) | Java 17·Spring Boot 의존성, 시험, Checkstyle, 실행 JAR을 정의한다. 산출물은 각각 `backend/api/build/libs/session-api-0.1.0-SNAPSHOT.jar`, `backend/processing/build/libs/api-server.jar`다. Checkstyle 실행에는 별도 JDK 21을 사용한다 |
| [infra/docker/java.Dockerfile](../../infra/docker/java.Dockerfile) | 저장소 루트 컨텍스트에서 Wrapper로 모듈별 `bootJar`를 만든다. `api` target은 입출구 서버(8090), `processing` target은 처리 서비스(8080)다. Java 17 JRE와 비루트 사용자로 실행한다 |
| [frontend/package.json](../../frontend/package.json), [frontend/package-lock.json](../../frontend/package-lock.json), [frontend/tsconfig.json](../../frontend/tsconfig.json), [frontend/vite.config.ts](../../frontend/vite.config.ts) | Node 24+의 npm 의존성·명령, TypeScript 검사와 Vite 번들을 정의한다. `npm run build`는 `tsc -b && vite build`로 `frontend/dist/`를 만든다. Vite의 `/api` 프록시는 개발·preview용이다 |
| [frontend/scripts/prepare-assets.mjs](../../frontend/scripts/prepare-assets.mjs), [frontend/model-asset.json](../../frontend/model-asset.json) | `prebuild`에서 MediaPipe WASM을 복사하고 지정 모델 파일을 준비한다. 모델 URL·파일명·SHA-256은 메타데이터 파일이 정한다. 결과는 `frontend/public/mediapipe/`를 거쳐 번들에 포함된다 |
| [infra/docker/frontend.Dockerfile](../../infra/docker/frontend.Dockerfile) | 저장소 루트 컨텍스트에서 `npm ci`·`npm run build`를 실행한다. `frontend/`와 함께 `model/prototype/`·`contracts/`를 복사하고, 결과 `dist`와 공용 nginx 설정을 런타임 이미지에 넣는다 |
| [infra/docker/inference.Dockerfile](../../infra/docker/inference.Dockerfile), [requirements-dev.txt](../../requirements-dev.txt) | 현재 HTTP 추론 서비스 `model.inference.app:app`을 Python 3.12·Uvicorn으로 패키징한다(8092). 현재 이미지가 설치하는 의존성 목록은 루트 `requirements-dev.txt`다 |
| [backend/inference/Dockerfile](../../backend/inference/Dockerfile), [backend/inference/requirements.txt](../../backend/inference/requirements.txt) | `backend/inference/`를 빌드 컨텍스트로 사용해 Python 3.11의 `app.main:app`을 실행한다(8000). 플랫폼의 Kafka 추론 서비스 이미지다 |
| [.dockerignore](../../.dockerignore) | 저장소 루트 컨텍스트의 비밀 파일·캐시·설치 의존성·생성 자산·자료 등을 빌드 전송에서 제외한다. 컨텍스트가 `backend/inference/`인 Dockerfile에는 루트 규칙이 적용되지 않는다 |
| [frontend/vercel.json](../../frontend/vercel.json) | Vercel의 Vite 빌드 명령·`dist` 출력·변경 감지에 따른 빌드 생략·검색 제외 응답 헤더를 정의한다. 프로젝트 연결·브랜치·환경 변수는 Vercel 설정에서 관리한다 |

이미지 빌드와 품질 검증은 별도 단계다. Java Dockerfile의 `bootJar`는 시험·Checkstyle을 실행하지 않고,
프론트 Dockerfile의 `npm run build`는 타입 검사·번들을 수행하지만 시험·ESLint는 실행하지 않는다.
검증 범위는 4절의 워크플로와 [품질 기준](../quality.md)이 정한다.

프론트에는 Windows Electron 패키징도 있다. `frontend/package.json`의 `desktop:pack`·`desktop:portable`은
`frontend/release/`에 앱을 만든다. `desktop:pack`이 이어서 실행하는
[frontend/scripts/copy-desktop.mjs](../../frontend/scripts/copy-desktop.mjs)는 `frontend/PoseGood.exe` 실행기와 바탕 화면 바로가기를 만든다.
이 산출물은 아래 GHCR 게시·Compose 배포 대상에 포함되지 않는다.

## 3. 실행 설정과 프록시의 책임

| 파일 | 책임과 적용 범위 |
| --- | --- |
| [.env.example](../../.env.example), [tools/compose_init.py](../../tools/compose_init.py) | 루트 Compose의 프로젝트명·포트·출처 허용·비밀 파일 위치를 안내하고 초기 비밀 파일을 만든다. 실제 `.env`와 `.cache/compose/secrets/`는 Git에서 제외하며, 초기화는 기존 비밀값을 덮어쓰지 않는다 |
| [infra/compose/env.example](../../infra/compose/env.example), [infra/compose/.gitignore](../../infra/compose/.gitignore) | 플랫폼 전용 `infra/compose/.env`의 서버 IP·외부 DB·포트·이미지·판정 설정을 정의하고 실제 환경 파일·비밀 파일을 제외한다. 루트 `.env.example`과 별도다 |
| [infra/compose/hadoop.env.example](../../infra/compose/hadoop.env.example), [infra/compose/spark-defaults.conf](../../infra/compose/spark-defaults.conf) | HDFS 컨테이너용 `hadoop.env`의 원본과 Spark 클라이언트 설정이다. 단일 DataNode에 맞춰 복제 수 1을 사용한다 |
| [backend/api/src/main/resources/application.properties](../../backend/api/src/main/resources/application.properties), [backend/processing/src/main/resources/application.yml](../../backend/processing/src/main/resources/application.yml) | 각 Java 프로세스의 DB·인증·추론·Kafka·Redis 등 런타임 설정과 환경 변수 매핑을 정의한다. Compose의 `environment`·`env_file`·비밀 마운트가 값을 공급한다. 직접 실행 시 dotenv 파일을 자동 로드하는 설정은 없다 |
| [infra/nginx/default.conf](../../infra/nginx/default.conf) | `frontend`·`web` 이미지가 공유하는 정적 화면·SPA fallback·`/health`·API 프록시 설정이다. `/api/` 접두사를 제거해 `api:8090`으로 전달하고 `/api/v2/realtime`은 WebSocket upgrade를 전달한다. 플랫폼 `io-api`는 이를 위해 `api` 네트워크 별칭을 갖는다 |
| [compose.test.yaml](../../compose.test.yaml) | 루트 구성에 겹쳐 쓸 때 시험 DB만 임의의 loopback 포트로 여는 오버레이다. 단독 배포 구성이 아니며 현재 `make check`·배포 워크플로에서 자동 사용하지 않는다 |

준비 확인도 구성별로 다르다. 루트 API의 `/health`는 DB의 `SELECT 1`을 확인하고 nginx의 `/health`는 nginx 응답만 확인한다.
플랫폼 `api-server`의 Compose healthcheck는 `/actuator/health/liveness`다. 외부 DB·Redis의 준비 상태는 readiness 등으로 별도 확인한다.

루트 구성은 `SPRING_CONFIG_IMPORT=configtree:/run/secrets/`로 DB 비밀번호·내부 토큰·JWT 서명 키를 공급한다.
플랫폼은 `.env`를 `api-server`·`io-api`에 주입하고, `infra/compose/secrets/`의 내부 토큰·JWT 키를
`io-api`와 필요한 추론 서비스에 읽기 전용으로 마운트한다. 두 구성의 비밀 파일 경로를 혼용하지 않는다.

컨테이너 화면은 기본적으로 같은 출처의 `/api`를 사용한다.
Vercel 화면은 [frontend/src/features/platform/serverConfig.ts](../../frontend/src/features/platform/serverConfig.ts)의
`VITE_API_BASE_URL`을 빌드 때 설정하며, WebSocket 주소도 같은 API 주소에서 만든다.
다른 출처 화면을 허용할 때 서버의 `POSEGOOD_CORS_ALLOWED_ORIGINS`·`POSEGOOD_REALTIME_ALLOWED_ORIGINS`에
정확한 출처를 넣고 HTTPS 공개에는 `POSEGOOD_COOKIE_SECURE=true`를 적용한다.
Dockerfile에 남은 `VITE_SERVER_ACCOUNTS`는 현재 FE 코드가 읽지 않으므로 계정 모드 전환 설정으로 설명하지 않는다.

[FE 배포 문서](../design/fe-deploy.md)의 공개 경로 결정은 Vercel 화면과 Cloudflare 터널 → API 전용 `gateway`다.
현재 저장소에는 `gateway`·`cloudflared` 서비스와 전용 설정 파일이 없으므로, 기존 `web` nginx와 구현 완료 상태를 구분한다.
서버 PC의 8080은 처리 서비스 포트이며 공개 사용자 API의 입구로 사용하지 않는다.

## 4. 검증·게시·배포 파일의 책임

| 파일 | 책임 |
| --- | --- |
| [Makefile](../../Makefile), [tools/dev.py](../../tools/dev.py), [tools/dev_tasks.py](../../tools/dev_tasks.py), [tools/runtime.py](../../tools/runtime.py) | 공통 개발·검증 명령이다. `make check`는 Python 시험 → FE 시험·타입/빌드 → BE 기본 시험·Checkstyle/빌드를 실행한다. `check-local`도 현재 같은 범위다 |
| [.github/workflows/harness.yml](../../.github/workflows/harness.yml) | 수동 실행 또는 다른 워크플로의 호출로 `make setup`·`make check`를 실행한다. Python 3.9/3.12 행렬을 사용한다. PR/push 자동 트리거는 이 파일에 없다 |
| [.github/workflows/backend-ci.yml](../../.github/workflows/backend-ci.yml), [.github/workflows/frontend-ci.yml](../../.github/workflows/frontend-ci.yml) | `develop` 대상의 관련 경로 PR에서 각각 Java 컴파일·`checkstyleMain`, FE `typecheck`·`lint`를 실행한다. 배포 워크플로가 이 두 CI를 직접 호출하지는 않는다 |
| [.github/workflows/db-ci.yml](../../.github/workflows/db-ci.yml) | DB 경로 변경의 PR과 `main`/`develop` push에서 최신 스키마·시드 및 기존 DB 마이그레이션 결과를 검사한다. 운영 DB에 마이그레이션을 적용하는 작업은 아니다 |
| [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml) | `main`·`release` push에서 `verify → publish → deploy`를 실행한다. `verify`는 harness를 호출한다. 배포는 `production` 환경과 직렬 실행 그룹을 사용한다 |
| [tools/deploy_images.py](../../tools/deploy_images.py) | `api`·`inference`·`frontend` 앱 이미지 **3개**를 Buildx로 GHCR에 게시한다. 커밋 SHA 태그와 플랫폼별 빌드를 만들고 실제 digest를 `images.json`에 기록한다. `processing`·`backend/inference`·플랫폼 이미지는 게시 대상이 아니다 |
| [tools/deploy_ssh.py](../../tools/deploy_ssh.py), [tools/deploy/ssh.py](../../tools/deploy/ssh.py), [tools/deploy/config.py](../../tools/deploy/config.py) | manifest·접속 설정과 고정 호스트 키를 검사한다. 루트 Compose·DB 초기화 파일·스키마/시드·호스트 실행 도구·manifest를 묶어 SSH/SCP로 전달하고 비밀값은 SSH stdin으로 보낸다 |
| [tools/deploy_host.py](../../tools/deploy_host.py), [tools/deploy/host.py](../../tools/deploy/host.py) | 호스트의 릴리스 디렉터리에서 잠금·비밀 파일 확인·레지스트리 로그인·이미지 pull·DB 준비·백업·서비스 기동·건강 검사·manifest 기록을 수행한다 |
| [tools/deploy/compose.py](../../tools/deploy/compose.py), [tools/deploy/secrets.py](../../tools/deploy/secrets.py) | 루트 `compose.yaml`을 명시적으로 선택하는 공통 실행과 비밀 파일 생성·기존 값 검증을 담당한다. 플랫폼용 배포 도구가 아니다 |

자동 배포 흐름은 다음과 같다.

1. harness의 기본 검증이 성공하면 앱 이미지 3개를 `linux/amd64,linux/arm64`로 게시한다.
   `images.json`은 Git SHA와 각 `ghcr.io/...@sha256:...` 참조를 저장하고 `release-images` artifact로 전달한다.
   MySQL은 루트 Compose에 고정된 외부 이미지를 사용한다.
2. `production` 환경의 SSH 설정·비밀값으로 `<DEPLOY_DIRECTORY>/releases/<SHA>/`에 릴리스를 전송한다.
   서버는 Linux/POSIX·Python·Docker/Compose를 준비하고, 호스트 키 fingerprint는 별도 경로로 확인한다.
3. 호스트는 `shared/secrets/`를 유지하고 digest 이미지를 pull한다. `--no-build`로 실행하므로 배포 호스트에서 앱을 다시 빌드하지 않는다.
4. `db`의 준비를 기다리고 `shared/backups/`에 백업한 뒤 전체 서비스에 `up --wait`를 실행한다.
   건강 검사 실패는 배포 실패로 처리하며 DB 볼륨은 삭제하지 않는다.
5. 성공한 경우에만 `shared/current.json`을 기록하고 기존 manifest는 `shared/previous.json`으로 남긴다.
   실패 시 이전 manifest가 남는다고 해서 컨테이너나 DB가 자동 복구되는 것은 아니다.

`production`에는 `DEPLOY_HOST`·`DEPLOY_PORT`·`DEPLOY_USER`·`DEPLOY_DIRECTORY`·`DEPLOY_HOST_FINGERPRINT` 변수와
`DEPLOY_KNOWN_HOSTS`·`DEPLOY_SSH_KEY`·`MYSQL_APP_PASSWORD`·`MYSQL_ROOT_PASSWORD`·`POSEGOOD_INTERNAL_TOKEN` Secrets가 필요하다.
`POSEGOOD_JWT_SECRET`은 선택이며 없으면 호스트에서 최초 생성 후 유지한다. 기존 비밀값 변경은 별도 교체 절차다.
GHCR 인증은 워크플로의 `GITHUB_TOKEN`을 사용한다. 도메인·TLS·터널 구성은 이 배포 스크립트가 생성하지 않는다.

## 5. DB 초기화·백업·복원의 책임

| 파일 | 책임 |
| --- | --- |
| [infra/mysql/initdb/10-posegood-schema.sh](../../infra/mysql/initdb/10-posegood-schema.sh) | 루트 MySQL의 빈 볼륨에서만 `schema_V2_6.sql`과 `seed_0*.sql`을 적용한다. `POSEGOOD_DB_INIT_SCHEMA=false`는 복원용 빈 스키마를 남긴다. 기존 볼륨에는 다시 실행되지 않는다 |
| [database/schema/](../../database/schema/), [database/seed/](../../database/seed/), [database/migrations/](../../database/migrations/), [database/README.md](../../database/README.md) | 스키마·시드·기존 DB 변경 절차의 정본이다. API는 시작할 때 필요한 구조를 확인하고 테이블을 생성·변경하지 않는다. SSH 배포 묶음에는 초기화용 스키마·시드가 포함되지만 마이그레이션 자동 실행 단계는 없다 |
| [tools/deploy_backup.py](../../tools/deploy_backup.py), [tools/deploy/backup.py](../../tools/deploy/backup.py) | 루트 Compose의 `db`를 `mysqldump --single-transaction`으로 백업해 새 private gzip 파일에 저장한다. 기존 파일을 덮어쓰지 않으며 실패한 불완전 파일은 제거한다 |
| [tools/deploy_restore.py](../../tools/deploy_restore.py), [tools/deploy/restore.py](../../tools/deploy/restore.py) | 명시한 Compose 프로젝트의 빈 DB로 복원한다. API·프론트 실행 중이거나 테이블이 있으면 거부한다. 운영 DB 자동 덮어쓰기나 볼륨 삭제를 수행하지 않는다 |

기존 DB의 마이그레이션은 호환성을 검토하고 DB 절차에 따라 별도로 적용한다.
이미지 rollback·DB 마이그레이션·백업 복원은 서로 다른 작업이다. 도구는 이전 이미지와 스키마의 호환성을 자동 판정하지 않는다.
일반 종료·배포에 `down --volumes`를 사용하지 않으며, 백업 보존과 실제 복구 전환은 운영자가 관리한다.
이 백업·복원 도구는 루트 Compose의 MySQL 대상이다. 플랫폼의 외부 MySQL·Kafka·Redis·HDFS 백업을 대신하지 않는다.

## 6. 검증 범위와 현재 확인 상태

`make check`에는 실제 MySQL 통합·Chrome·Docker/Compose·SSH 배포가 포함되지 않는다.
FE PR의 lint와 DB CI도 배포의 harness 호출에 자동 포함되는 검사가 아니며, 브랜치 보호 required checks는 GitHub 설정의 책임이다.
플랫폼 점검은 [tools/platform/integration_test.sh](../../tools/platform/integration_test.sh)를 명시적으로 실행한다.
파일이 존재하거나 기본 검증이 통과한 사실만으로 서버 연결·터널·원격 배포 성공을 판단하지 않는다.

2026-10-30 최신화는 저장소 파일과 호출 관계를 대조한 문서 갱신이다.
실제 GitHub `production` 설정·이미지 게시·현재 실행 중인 컨테이너·외부 도메인/터널·백업 복원 상태는 이번 작업에서 확인하지 않았다.
FE 도메인·Vercel의 기존 진행 기록은 [FE 배포 문서](../design/fe-deploy.md)를 따르되, 이 ADR에서 현재 운영 상태로 재확인한 것은 아니다.
실행 명령은 [인프라 안내](../../infra/README.md), 범위별 검증과 완료 판단은 [품질 기준](../quality.md)을 함께 따른다.
