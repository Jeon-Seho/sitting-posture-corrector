# Compose 실행과 배포

MySQL·Spring API·FastAPI·Nginx/React를 함께 실행한다. 판정은 API 안에서 한다([ADR 0020](../docs/decisions/0020-single-api-decision-engine.md)).
Docker Engine/Desktop와 Docker Compose가 필요하다. 앱 이미지 빌드에는 Docker가 공식 registry와
Maven Central·Gradle 배포 서버(`services.gradle.org`)·PyPI·npm·MediaPipe 자산에 접근할 수 있어야 한다. 호스트 JDK/Python/Node 설치 없이 앱을 실행할 수 있다.

```sh
make init-compose
docker compose up -d --build --wait --wait-timeout 180
```

`make`가 없는 환경은 `python tools/compose_init.py`로 초기화한다.
Windows 바인드 마운트에서는 비밀 파일이 world-writable로 보여 mysql 클라이언트가 `*.cnf`를 무시한다.
DB healthcheck와 `tools/deploy/backup.py`·`restore.py`는 컨테이너 안의 0400 복사본을 사용한다(2026-10-11).
[앱](http://127.0.0.1:8080/)에서 이메일·비밀번호로 가입한다. 새 계정의 서비스 자료 보관 동의는 직접 선택한다.
카메라는 측정 준비에서 직접 켠다. Compose 프론트는 계정 모드이며 기존 브라우저 기록을 자동 업로드하지 않는다.

```sh
docker compose ps
docker compose logs --tail 100 api
docker compose down
```

일반 종료는 DB 볼륨을 보존한다. `down --volumes`는 DB 자료 삭제이므로 일반 종료/배포에 사용하지 않는다.
초기화 도구는 `.cache/compose/secrets`에 무작위 비밀값을 만들고 기존 값을 덮어쓰지 않는다.
비밀값은 화면·로그·Git에 넣지 않는다. 파일은 서비스 사용자에게 읽기 권한을 주고 부모 폴더는 0700으로 제한한다.
Compose 파일 secret는 호스트 파일을 mount하는 방식이므로 파일과 호스트 계정 접근 권한을 함께 관리한다.

macOS에서 저장소가 Desktop 폴더에 있으면 Docker의 폴더 접근 승인을 기다릴 수 있다.
Docker에 해당 접근을 허용하거나, 다음처럼 Desktop 밖의 지속되는 private 경로를 사용한다.
`.env`의 `POSEGOOD_SECRETS_DIR`도 같은 절대 경로로 설정한다. 운영 비밀값을 임시 폴더에 보관하지 않는다.

```sh
python tools/compose_init.py --secrets-dir "$HOME/.config/posegood/secrets"
```

이 Mac의 검증에서는 private 시스템 임시 폴더의 합성 비밀값을 사용해 OS 권한 변경 없이 실행했다.
테스트가 종료되면 해당 폴더를 정리한다. 일반 실행의 기본 Desktop 경로 접근 승인은 별도 환경 조건이다.

설정 기본값은 [.env.example](../.env.example)에 있다. 필요할 때 `.env`로 복사하여 포트 등을 바꾼다.
기본 프론트는 `127.0.0.1:8080`만 공개한다. MySQL·API·추론은 내부 네트워크에 있고 host port를 열지 않는다.
외부 사용은 TLS reverse proxy와 도메인을 준비하고 `POSEGOOD_COOKIE_SECURE=true`를 설정한다.
브라우저 카메라는 HTTPS 또는 localhost 같은 보안 컨텍스트가 필요하다.
`/api/health`는 실제 DB 연결까지 확인한다. 추론은 공유 내부 토큰이 없는 요청을 거부한다. 실시간 채널 `/api/v2/realtime`([WebSocket v2](../contracts/realtime/realtime-ws.v2.schema.json))은 Nginx가 WebSocket으로 전달한다. 앱이 v2로 넘어갈 때까지 `/api/v1/realtime`도 함께 열어 두고, 넘어간 뒤 지운다.

## 전체 검증

```sh
make setup
make check
```

전체 개발 게이트는 JDK 17·Node 24+·Python 3.9+·Chrome/Chromium·실행 중인 Docker가 필요하다. 백엔드는 Gradle Wrapper로 빌드한다.
구형 Compose 종합 검사는 2026-10-29 제거했다. 기본 `make check`는 Python·FE·BE 기본 검사이며 DB·브라우저 연결을 검증하지 않는다.
MySQL 통합과 JWT 수동 점검은 [품질 기준](../docs/quality.md)의 직접 명령을 따른다. 배포·백업·복원 도구와 DB CI는 유지한다.
Docker가 없으면 해당 게이트는 실패한다. `make check-local`은 Compose를 제외한 검증이며 전체 검증 성공을 의미하지 않는다.
실제 카메라·의학적 효과·연구 정확도·외부 배포 검증은 포함하지 않는다.

## GitHub Actions

[harness](../.github/workflows/harness.yml)는 PR/push에서 검증한다.
[deploy](../.github/workflows/deploy.yml)는 `main` 또는 `release` push에 전체 검증 성공 후
네 앱 이미지를 GHCR에 게시하고 SHA와 각 이미지 digest를 묶은 manifest를 만든다.
배포는 `production` 환경에서 직렬 실행하며 SSH 호스트 키를 고정한다. secrets는 SSH stdin으로 전달한다.
DB 볼륨을 유지하고 변경 전 백업 후 서비스 건강 검사를 실행한다. 새 볼륨은 `infra/mysql/initdb`가 스키마 V2.3·시드를 적용하고,
기존 볼륨의 스키마 변경은 `database/migrations/` 절차로 먼저 적용한다(API가 시작할 때 확인). 실패한 배포를 성공으로 기록하지 않는다.

배포 서버는 아직 미정이다. 다음 환경 설정은 서버 준비 뒤 등록한다.

| `production` 설정 | 이름 | 값 |
| --- | --- | --- |
| Variables | `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_DIRECTORY` | SSH 호스트·포트·사용자·절대 배포 경로 |
| Variables | `DEPLOY_HOST_FINGERPRINT` | 별도 경로로 확인한 SSH host public key의 SHA256 fingerprint |
| Secrets | `DEPLOY_KNOWN_HOSTS`, `DEPLOY_SSH_KEY` | 고정한 known_hosts 한 줄과 전용 SSH 접속 키 |
| Secrets | `MYSQL_APP_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `POSEGOOD_INTERNAL_TOKEN` | 초기 생성 후 유지할 DB/서비스 비밀값 |
| Secrets (선택) | `POSEGOOD_JWT_SECRET` | 로그인 토큰 서명 키(32자 이상, ADR 0031). 없으면 호스트가 처음 한 번 만들어 `shared/secrets`에 유지한다. 바꾸면 모든 사용자가 다시 로그인 |

GHCR 로그인은 workflow의 `GITHUB_TOKEN`을 사용한다. 호스트는 Linux·Python 3.9+·Docker/Compose가 필요하다.
게시 workflow는 `linux/amd64,linux/arm64` 두 플랫폼의 index digest를 기록한다.
MySQL 이미지도 확인한 두 플랫폼 index digest로 고정한다. 로컬에서는 현재 호스트 플랫폼으로 빌드/실행했고
실제 GitHub의 두 플랫폼 게시와 대상 호스트 배포는 아직 실행하지 않았다.
GitHub 환경 보호·required checks·외부 TLS와 호스트 백업 보존 정책은 저장소/운영자가 설정한다.
코드에 주소/키를 임의로 넣지 않으며 실제 workflow·이미지 게시·외부 배포 완료를 로컬 검증으로 주장하지 않는다.

## 백업과 rollback

```sh
python tools/deploy_backup.py --output .cache/backups/posegood.sql.gz
```

백업은 MySQL `--single-transaction` dump를 새 private gzip 파일에 저장하며 기존 파일을 덮어쓰지 않는다.
실패하면 불완전한 결과를 지운다. 백업에는 계정 자료가 있으므로 Git에 추가하지 않고 접근/보존 정책을 적용한다.
복원은 별도 빈 DB에서 검증한 뒤 전환한다. 운영 DB 자동 덮어쓰기와 volume 삭제는 제공하지 않는다.
복구용 프로젝트의 DB만 시작한 뒤 아래 명령을 사용한다. 앱/API가 실행 중이거나 테이블이 있는 DB는 거부한다.

```sh
docker compose --project-name posegood-recovery up -d --wait db
python tools/deploy_restore.py --project posegood-recovery --input .cache/backups/posegood.sql.gz
```

복원 실패의 부분 자료는 조사할 수 있도록 남긴다. 실패 DB를 계속 사용하는 대신 별도 빈 DB로 다시 검증한다.
앱 이미지 rollback도 DB 마이그레이션이 이전 이미지와 호환되는지 확인한 경우에만 수행한다.
배포 manifest는 `shared/current.json`, 직전 manifest는 `shared/previous.json`, 백업은 `shared/backups/`에 기록한다.
백업에서 복구하면 백업 이후 쓰기/삭제는 되돌아갈 수 있으므로 복구 시점과 삭제 반영 절차를 운영자가 검토한다.

빅데이터 전달·분석은 [아키텍처 v5.2 스택별 역할](../docs/design/architecture_v5.2_stack_roles.md)을 따른다.

## 빅데이터 플랫폼 (서버 PC)

Kafka·Redis·HDFS·Spark와 판정 서비스(`backend/processing`)·추론 서비스(`backend/inference`)는
[compose/bigdata.yaml](compose/bigdata.yaml)로 따로 띄운다(DevOps, 아키텍처 v5.2). MySQL은 컨테이너가 아닌 외부 서버다.
프로젝트 이름은 파일 안의 `name: platform`으로 고정해 옛 `platform/` 위치의 볼륨(`platform_*`)을 그대로 쓴다.

실행 환경마다 다른 값(서버 IP·DB·바깥 포트·바인딩·이미지 태그)은 모두 `infra/compose/.env`에서 읽는다(D-24).
필수는 `SERVER_LAN_IP`·`SERVICE_DB_SCHEMA`(없으면 compose가 시작하지 않음)와 `DB_*`, 나머지는 비워 두면 기본값이다 —
목록과 설명은 [compose/env.example](compose/env.example). 메모리 상한·컨테이너끼리 쓰는 이름·포트·토픽은 compose에 고정한다.

```sh
cp infra/compose/env.example infra/compose/.env           # 값 채우기(커밋하지 않음)
cp infra/compose/hadoop.env.example infra/compose/hadoop.env
docker compose -f infra/compose/bigdata.yaml up -d --build
tools/platform/integration_test.sh --quick
```

### FE ↔ BE 서버 안 연동 시험 (T-13)

FE 화면 컨테이너 `web`(팀 `infra/docker/frontend.Dockerfile` — 화면 빌드 + `infra/nginx/default.conf`)을 프로필 `io`로 io-api와 함께 띄운다.
화면(`/`)과 API(`/api/` → io-api, `/api/v2/realtime`)가 같은 nginx에서 나와 같은 출처이므로 CORS가 필요 없다. 포트는 `127.0.0.1:${WEB_HOST_PORT:-8088}`.

```sh
C="docker compose -f infra/compose/bigdata.yaml"
$C --profile io up -d --build web       # io-api가 healthy가 된 뒤 web이 뜬다
curl -s http://127.0.0.1:8088/health     # {"status":"ok"} (nginx)
python3 tools/platform/io_api_smoke.py --base http://127.0.0.1:8088/api
tools/platform/integration_test.sh --quick   # 13단계
```

다른 PC 브라우저로 화면을 볼 때는 SSH 터널 `ssh -L 8088:127.0.0.1:8088 <계정>@<서버>` 뒤 `http://localhost:8088`(localhost라 웹캠 허용).
인터넷 공개는 아래 "인터넷 공개 입구 (D-43)" — 화면은 Vercel, 서버는 API 전용 `gateway`만 터널로 연다. `web`은 서버 안 시험용으로 그대로 둔다.

### HDFS 복제 수 (D-61)

DataNode가 하나라 복제 수는 1이다. HDFS 컨테이너는 `hadoop.env`의 `HDFS_CONF_dfs_replication=1`, Spark(HDFS 클라이언트)는
`infra/compose/spark-defaults.conf`(`spark.hadoop.dfs.replication 1`, spark 컨테이너에 읽기 전용 마운트)를 쓴다.
통합 테스트 4단계가 복제 부족 블록 0을, 5단계가 Spark가 쓴 파일의 복제 수 1을 확인한다.

```bash
docker compose -f infra/compose/bigdata.yaml up -d spark        # 마운트 반영
docker exec hdfs-namenode hdfs dfs -setrep -R 1 /               # 이미 복제 3으로 쓴 파일을 1로(한 번만)
docker exec hdfs-namenode hdfs dfsadmin -report | grep 'Under replicated'   # 0
```

### 입출구 서버 (io-api, 서버 PC)

팀 `backend/api`([API 명세](../docs/design/api-spec.md)의 REST와 WebSocket `/v2/realtime`, 전환 기간에는 `/v1/realtime`도)를 같은 compose의 프로필 `io`로 띄운다.
DB는 외부 MySQL의 서비스 DB(V2.6, `.env`의 `SERVICE_DB_SCHEMA` — API가 시작할 때 버전을 확인한다)이고 접속 정보는 위 `.env`의 `DB_*`를 쓴다(다르면 `IO_DB_USER`·`IO_DB_PASSWORD`·`IO_DB_NAME`).
점수는 같은 프로필의 `inference`(팀 `model/inference`, 포트 없음)를 내부 토큰으로 부른다.
로그인은 access·refresh 토큰([ADR 0031](../docs/decisions/0031-jwt-access-refresh-login.md))이고 서명 키가 필요하다(D-71).
처음 한 번 두 비밀값 파일을 만든다(Git 제외, 값은 화면·문서·채팅에 남기지 않는다).

```sh
mkdir -p infra/compose/secrets && chmod 700 infra/compose/secrets
python3 -c "import secrets; print(secrets.token_urlsafe(48))" > infra/compose/secrets/posegood.internal-token
# 로그인 토큰 서명 키(32바이트 이상, 줄바꿈 없이). 바꾸면 모든 사용자가 다시 로그인한다
python3 -c "import secrets,sys; sys.stdout.write(secrets.token_urlsafe(48))" > infra/compose/secrets/posegood.auth.jwt-secret
chmod 644 infra/compose/secrets/posegood.internal-token infra/compose/secrets/posegood.auth.jwt-secret   # 컨테이너 사용자(uid 10001)가 읽는다
docker compose -f infra/compose/bigdata.yaml --profile io up -d --build io-api
curl -s http://127.0.0.1:8090/health                      # {"status":"ok","storage":"mysql"}
python3 tools/platform/io_api_smoke.py                     # REST 점검(통합 테스트 10단계와 같음)
```

- 포트는 기본 `127.0.0.1:8090`(서버 PC 안, `.env`의 `IO_API_BIND`·`IO_API_HOST_PORT`)이다. 화면과 함께 시험할 때는 위 "FE ↔ BE 서버 안 연동 시험"의 web(nginx)으로 들어온다(T-13).
- 앱은 경로 앞에 `/api`를 붙이고 프록시가 뗀다. io-api에 직접 보낼 때는 접두사 없이(`/v2/auth/me`). 보호 요청은 로그인 응답의 `access_token`을 `Authorization: Bearer`로 보낸다(CSRF 없음). 실시간도 같다 — 직접 붙을 때 `ws://127.0.0.1:8090/v2/realtime`, 인증은 `hello.access_token`(통합 테스트 12단계 `ws_realtime_smoke.py`).
- 다른 출처 화면(Vercel `https://app.posegood.site`)이 부를 때는 `.env`의 `POSEGOOD_CORS_ALLOWED_ORIGINS`(REST)·`POSEGOOD_REALTIME_ALLOWED_ORIGINS`(WebSocket)에 출처를 **끝 `/` 없이** 넣고, HTTPS 공개 때 `POSEGOOD_COOKIE_SECURE=true`. 비우면 같은 출처(web 8088)만 된다.
- `docker compose ... down`은 프로필이 켜진 서비스만 멈춘다. io까지 멈출 때는 `--profile io`를 붙인다.
- 지금은 판정을 io-api 안에서 한다(코드 그대로). WebSocket → Kafka 전환은 [계획 0031](../docs/plans/active/0031-realtime-kafka-transition.md)(`ws`, PM).
  준비로 io-api에 Kafka·Redis 주소(`kafka:19092`·`redis`)와 `POSEGOOD_REALTIME_PIPELINE`(기본 `local` = 지금 경로)을 넣었다.
  `kafka`로 바꾸는 것은 `ws` Kafka 연결 코드가 들어간 뒤다.

처리 서비스(api-server)의 운영·확인 경로는 [처리 서비스 HTTP API](../docs/design/processing-api-spec.md), 토픽·메시지·DLQ는 [Kafka 명세](../docs/design/kafka-spec.md)다.

### 인터넷 공개 입구 (D-43, gateway·Cloudflare 터널)

화면은 Vercel(`https://app.posegood.site`)이 내고, 서버는 API만 공개한다(FE 배포 구조는 [fe-deploy](../docs/design/fe-deploy.md) 6장).

```
브라우저 ─ https://api.posegood.site/api/… · wss://…/api/v2/realtime ─ Cloudflare(HTTPS·요청 제한, FE 계정)
  └ 터널 posegood-api ─ cloudflared(프로필 edge, 포트 없음) ─ http://gateway:80 ─ gateway(nginx, API만, 포트 없음) ─ api:8090(io-api)
서버 안 시험: web(127.0.0.1:8088, 화면 + 같은 API 중계) — SSH -L 8088
```

| 파일 | 내용 | Git |
| --- | --- | --- |
| `infra/nginx/gateway.conf` | `/api/` → io-api, `/api/v2/realtime`, `/health`, 그 밖 404. `X-Forwarded-Proto https`, 실제 사용자 IP(`CF-Connecting-IP`), 내부 토큰 헤더 지움 | 커밋 |
| `infra/compose/cloudflared/config.yml` | 경로: `api.posegood.site` → `http://gateway:80`, 나머지 404 | 커밋 |
| `infra/compose/secrets/cloudflared.env` | `TUNNEL_TOKEN=…` 한 줄(FE가 서버에서 직접 넣음, `chmod 600`) | **제외** |
| `infra/compose/secrets/posegood.auth.jwt-secret` | 로그인 토큰 서명 키(위 입출구 서버 절) | **제외** |

- 처리 서비스(api-server 8080)·추론(8000)은 인증이 없어 `127.0.0.1`에만 연다(`.env`의 `API_SERVER_BIND`·`INFERENCE_BIND`). 터널은 이 포트를 가리키지 않는다.
- 같은 터널을 두 곳에서 돌리지 않는다(요청이 나뉜다). 서버의 cloudflared 하나만 쓴다. Cloudflare 계정 권한 파일(`cert.pem`)은 서버에 두지 않는다.
- 토큰·`.env` 값은 화면·로그·채팅·저장소에 남기지 않는다. 토큰이 새면 FE가 터널을 다시 만들고 새 토큰을 넣는다.

```sh
C="docker compose -f infra/compose/bigdata.yaml"
# 1) .env — 공개 값(끝 / 없이) — env.example 6·7장
#    POSEGOOD_CORS_ALLOWED_ORIGINS=https://app.posegood.site
#    POSEGOOD_REALTIME_ALLOWED_ORIGINS=https://app.posegood.site
#    POSEGOOD_COOKIE_SECURE=true
#    API_SERVER_BIND=127.0.0.1  INFERENCE_BIND=127.0.0.1   PUBLIC_API_URL=https://api.posegood.site
$C up -d --no-build api-server inference-service          # 바인딩 반영
$C --profile io up -d --no-build --force-recreate io-api  # 출처·쿠키 값 반영
$C --profile io up -d --no-build gateway
docker exec gateway wget -q -O - http://127.0.0.1/api/health   # {"status":"ok","storage":"mysql"}
# 2) 토큰 자리(빈 파일) — 내용은 FE가 서버에서 직접 넣는다
install -m 600 /dev/null infra/compose/secrets/cloudflared.env
# 3) 토큰이 들어간 뒤
$C --profile io --profile edge up -d --no-build cloudflared
docker logs cloudflared 2>&1 | grep 'Registered tunnel connection'
curl -i https://api.posegood.site/health                 # 200 (530 = 터널 미연결, 502 = gateway 연결 문제)
tools/platform/integration_test.sh --quick               # 14단계(터널 경유 REST·wss 포함)
```

- `--config`와 토큰을 같이 쓰는 실행이 안 되면 `command`를 `["tunnel", "--no-autoupdate", "run", "--url", "http://gateway:80"]`로 바꾼다(경로가 하나뿐이라 같은 결과).
- 멈출 때는 프로필을 모두 붙인다: `$C --profile io --profile edge down`(프로필 없는 `down`은 io·edge 서비스를 남긴다). 터널만 끌 때는 `$C --profile edge stop cloudflared`.
- 문제가 생기면 볼 곳은 [fe-deploy](../docs/design/fe-deploy.md) 6장 5-3 표와 같다(530·502·CORS·WS 출처·JWT·쿠키).

### 판정 (api-server `judge`, D-22·D-53)

api-server가 `posture.inference.v1`을 그룹 `judge-v1`로 구독해 상태머신으로 판정하고 `posture.episodes.v1`로 발행한다(CEP 엔진은 쓰지 않는다).
확인은 `GET /judge/v1/status`·`GET /judge/v1/sessions/{session_id}`, 설정은 `.env`의 `JUDGE_*`(정책 기본값·세션 만료·상태 저장).
옛 `posture.summary` 경로(`/cep/*`·`CEP_*`·그룹 `api-server-cep`)는 D-38에서 지웠다 — 아래 "옛 경로 정리".

D-53으로 그룹 이름이 `api-server-cep-v1` → `judge-v1`로 바뀌었다. 새 그룹은 커밋 위치가 없어 처음부터(`earliest`) 읽으므로,
api-server를 새 이미지로 다시 만들기 **전에** 새 그룹의 위치를 끝(latest)으로 만들고, 다시 만든 뒤 옛 그룹을 지운다(한 번만).

```bash
K="docker exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092"
$K --group judge-v1 --topic posture.inference.v1 --reset-offsets --to-latest --execute
docker compose -f infra/compose/bigdata.yaml up -d --build api-server
$K --describe --group judge-v1                 # 컨슈머 3개 참여, LAG 0
$K --delete --group api-server-cep-v1          # 옛 그룹(멤버 없을 때만 지워진다)
```

### 옛 경로 정리 (D-38, 2026-10-21)

옛 `posture.summary` 경로 — `/api/v1/posture/summary` → `posture.summary` → 추론 옛 컨슈머(그룹 `inference-service`) → `posture.inference`
→ 처리 서비스 `cep` 패키지(그룹 `api-server-cep`, Redis `posture:state:*`, 테스트용 DB `posture_app`) → posture-sink(HDFS `/posture/features/stream`) —
를 코드에서 지웠다. 추론 서비스는 v1 컨슈머 하나(규칙 점수, D-63)이고 처리 서비스 연결 풀의 기본 DB는 `SERVICE_DB_SCHEMA`다.
새 이미지로 바꾼 뒤 서버에 남은 것을 한 번 지운다(쓰는 서비스가 없어 지워도 영향 없음).

```bash
C="docker compose -f infra/compose/bigdata.yaml"
docker exec spark pkill -f posture_sink_stream.py || true          # 돌고 있던 posture-sink 멈춤
$C up -d --build api-server inference-service
K="docker exec kafka /opt/kafka/bin"; B="--bootstrap-server localhost:9092"
$K/kafka-consumer-groups.sh $B --delete --group api-server-cep     # 멤버 없을 때만 지워진다
$K/kafka-consumer-groups.sh $B --delete --group inference-service
$K/kafka-topics.sh $B --delete --topic posture.summary
$K/kafka-topics.sh $B --delete --topic posture.inference
docker exec redis sh -c "redis-cli --scan --pattern 'posture:state:*' | xargs -r redis-cli del"
docker exec hdfs-namenode hdfs dfs -rm -r -skipTrash /posture/features/stream /posture/checkpoints/posture-sink
```

`.env`의 `DB_NAME`·`CEP_*`는 더 이상 읽지 않는다(남아 있어도 무시). MySQL의 `posture_app` 스키마(옛 시험 행)는 DB 담당과 정한 뒤 지운다.
통합 테스트 7단계(옛 경로 T-10·posture-sink 적재)는 없어졌고, 2단계가 옛 토픽·그룹이 남아 있으면 안내한다.

### 판정 결과 저장 (api-server `report`, D-30·D-51)

api-server가 `posture.episodes.v1`을 따로 구독해(그룹 `report-store-v1`) `posture_service`(V2.3)의
`collapse_event`·`correction_alert`·`excluded_interval`(D-39 제외 구간)과 `monitor_session` 종료 값(`ended_at`·`good_sec`)을 쓴다. 세션 행은 입출구 서버가 만든다 —
행이 없는 세션은 건너뛰고 `GET /report/store`의 `sessionNotFound`로 센다. 서비스 DB 준비 상태는 `GET /store/service-db`(V2.3, 통합 테스트 6단계).
(D-54) 알림 행을 새로 쓰고 세션 알림이 켜져 있고 10초 안의 사건이면 `posture.alerts.v1`(보존 3일)로도 낸다 — 입출구 서버 `ws`가 앱에 `alert`로 보낸다.

- 기본 판정 정책은 이름이 없고 값 4개로 찾는다: `.env`의 `SERVICE_DB_DEFAULT_THRESHOLD`·`_HOLD_SECONDS`·`_RECOVER_SECONDS`·`_REALERT_SECONDS`
  (기본 0.7·3·3·60 — 입출구 서버 `posegood.default-policy.*`와 같아야 한다).
- 시험 서버에서만 `.env`에 `REPORT_TEST_FIXTURES_ENABLED=true` — 통합 테스트 11단계가 시험 계정·기준 자세·세션 행
  (`test-*@example.invalid`, 합성 좌표)을 만들어 저장·재전송 멱등·제외 구간(휴식·끝 공백)을 확인하고 지운다. 운영에서는 켜지 않는다.
