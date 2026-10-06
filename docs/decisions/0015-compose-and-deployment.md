# ADR 0015: Compose 전체 실행과 GitHub Actions 배포

- 분야: 데브옵스, 백엔드
- 작업: GP-0078
- 상태: accepted
- 날짜: 2026-10-01
- 근거: 사용자가 Docker Compose 즉시 실행과 GitHub Actions 자동 배포 설정을 요청했다.
- 배포 환경: 사용자 확인으로 서버/도메인/접속 키는 미정이다.

## 결정

DB·API·CEP·추론·프론트를 Compose 서비스로 실행한다. 프론트가 같은 출처의 API를 proxy한다.
DB와 판정 서비스는 내부 네트워크에서 사용하고 로컬 실행은 프론트만 loopback으로 공개한다.
건강 검사로 DB/서비스 준비를 확인하고, DB 자료는 명명 볼륨에 보관한다.
비밀값은 무시된 로컬 파일과 GitHub 환경/Secrets에서 주입하며 실제 값은 저장소에 추가하지 않는다.

배포 자동화는 검증 성공 뒤 이미지를 게시하고 소스 SHA와 같은 불변 식별자를 사용한다.
SSH 대상·호스트 키·접속 키·배포 경로는 실제 서버 준비 뒤 GitHub 환경에 등록한다.
배포를 직렬화하고 건강 검사 실패를 성공으로 처리하지 않는다. 기존 DB 볼륨을 보존한다.
DB 마이그레이션·백업·복구와 앱 이미지 rollback은 다른 작업으로 설명하고 데이터 손실을 자동으로 되돌렸다고 주장하지 않는다.

## 근거와 실행 범위

Compose의 서비스 시작과 준비 상태는 다르므로 [Docker 공식 건강 검사/시작 순서](https://docs.docker.com/compose/how-tos/startup-order/)를 적용한다.
배포 설정은 [GitHub 공식 환경 구성](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/deploy-to-environment)을 따른다.
현재 작업은 로컬 Compose와 워크플로/스크립트를 검증하며 실제 외부 배포와 환경/Secrets 등록은 실행하지 않는다.
[실행 계획](../plans/completed/0017-mysql-accounts-compose-deployment.md)에 관찰 결과와 미검증 범위를 남긴다.
