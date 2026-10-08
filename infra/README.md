# Compose 실행과 배포

MySQL·Spring API·Esper CEP·FastAPI·Nginx/React를 함께 실행한다.
Docker Engine/Desktop와 Docker Compose가 필요하다. 앱 이미지 빌드에는 Docker가 공식 registry와
Maven Central·PyPI·npm·MediaPipe 자산에 접근할 수 있어야 한다. 호스트 JDK/Python/Node 설치 없이 앱을 실행할 수 있다.

```sh
make init-compose
docker compose up -d --build --wait --wait-timeout 180
```

`make`가 없는 환경은 `python tools/compose_init.py`로 초기화한다.
Windows 바인드 마운트에서는 비밀 파일이 world-writable로 보여 mysql 클라이언트가 `*.cnf`를 무시한다.
DB healthcheck는 0400 복사본을 사용한다. `tools/deploy/backup.py`·`restore.py`는 아직 같은 문제가 있다.
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
기본 프론트는 `127.0.0.1:8080`만 공개한다. MySQL·API·CEP·추론은 내부 네트워크에 있고 host port를 열지 않는다.
외부 사용은 TLS reverse proxy와 도메인을 준비하고 `POSEGOOD_COOKIE_SECURE=true`를 설정한다.
브라우저 카메라는 HTTPS 또는 localhost 같은 보안 컨텍스트가 필요하다.
`/api/health`는 실제 DB 연결까지 확인한다. CEP·추론은 공유 내부 토큰이 없는 판정 요청을 거부한다.

## 전체 검증

```sh
make setup
make check
```

전체 개발 게이트는 JDK 21·Maven·Node 24+·Python 3.9+·Chrome/Chromium·실행 중인 Docker가 필요하다.
`make check-compose`는 실제 MySQL과 컨테이너·계정 UI를 별도로 검증한다. 임시 프로젝트/볼륨과 독립 브라우저만 사용한다.
Docker가 없으면 해당 게이트는 실패한다. `make check-local`은 기존 로컬 모드 검증이며 전체 검증 성공을 의미하지 않는다.
실제 카메라·의학적 효과·연구 정확도·외부 배포 검증은 포함하지 않는다.

## GitHub Actions

[harness](../.github/workflows/harness.yml)는 PR/push에서 검증한다.
[deploy](../.github/workflows/deploy.yml)는 `main` 또는 `release` push에 전체 검증 성공 후
네 앱 이미지를 GHCR에 게시하고 SHA와 각 이미지 digest를 묶은 manifest를 만든다.
배포는 `production` 환경에서 직렬 실행하며 SSH 호스트 키를 고정한다. secrets는 SSH stdin으로 전달한다.
DB 볼륨을 유지하고 변경 전 백업 후 서비스 건강 검사를 실행한다. 새 볼륨은 `infra/mysql/initdb`가 스키마 V1.1·시드를 적용하고,
기존 볼륨의 스키마 변경은 `database/migrations/` 절차로 먼저 적용한다(API가 시작할 때 확인). 실패한 배포를 성공으로 기록하지 않는다.

배포 서버는 아직 미정이다. 다음 환경 설정은 서버 준비 뒤 등록한다.

| `production` 설정 | 이름 | 값 |
| --- | --- | --- |
| Variables | `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_DIRECTORY` | SSH 호스트·포트·사용자·절대 배포 경로 |
| Variables | `DEPLOY_HOST_FINGERPRINT` | 별도 경로로 확인한 SSH host public key의 SHA256 fingerprint |
| Secrets | `DEPLOY_KNOWN_HOSTS`, `DEPLOY_SSH_KEY` | 고정한 known_hosts 한 줄과 전용 SSH 접속 키 |
| Secrets | `MYSQL_APP_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `POSEGOOD_INTERNAL_TOKEN` | 초기 생성 후 유지할 DB/서비스 비밀값 |

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

빅데이터 전달·분석은 [플랫폼 책임과 후속 작업](../docs/design/data-platform-boundary.md)을 따른다.
