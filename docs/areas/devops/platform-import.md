# DevOps 플랫폼(dockerized-bigdata-env) 팀 저장소 이전

- 분야: 데브옵스
- 작업: GP-0122

## 요청과 완료 기준

우리 저장소 `ghdrb1246/dockerized-bigdata-env`의 `main`(`e23b2e1`) 스냅샷을 `platform/`으로 옮긴다(이력 제외).
완료 기준: `make check`의 저장소·관리판 검사 통과, 서버 PC에서 `platform/` 기준 기동과 T-10 재생 확인.

## 진행 기록

- 2026-10-07 PR #17로 `DevOps`에 병합. 이력은 가져오지 않음 — 원본 첫 커밋에 참여자 CSV·모델 가중치가 있어 팀 규칙상 이력에 남기면 안 됨.
- 제외: `mysql/posture-pilot-*.csv`, `inference-service/app/models/test_lstm.pt`(`platform/.gitignore`에 `*.pt`), `.github/workflows`(팀 CI에 맞춰 재구성 예정), `.vscode`, `docs/CONVENTIONS.md`(팀 규칙으로 대체).
- 2026-10-07 `platform/` MD 13개에 분야·작업 번호 머리말 추가(관리판 검사 대응).
- 서버 PC 전환: `platform/.env`에 `COMPOSE_PROJECT_NAME=dockerized-bigdata-env`를 넣어 기존 Kafka·HDFS 볼륨을 그대로 사용(폴더 이름이 프로젝트 이름이 되어 빈 볼륨이 생기는 것을 막음).

## 검증과 남은 사항

- 2026-10-07 서버 PC: 컨테이너 기동, readiness(db·redis) UP, `posture.inference` 파티션 3, 판정 컨슈머 3스레드 할당·lag 0.
- 2026-10-07 서버 PC T-10 재생: 850/850 전송(HTTP 202) → 확정 → 재알림(alertCount=2, 63.0s) → 종료(73.1s), `/cep/events/recent` = durationSeconds 73.1, alertCount 2, recovered true. 이전 위치와 같은 결과.
- 남은 것: 쓰이지 않는 볼륨(`platform_*`, `project_*`) 정리, 우리 원본 저장소 보관(Archive) 처리.
