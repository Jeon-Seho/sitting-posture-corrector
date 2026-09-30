# API·CEP 작업 인계

2026-09-30 Mac 검증본. 협업 저장소이므로 **main/develop에 직접 push하지 않는다**.
현재 작업 브랜치는 `codex/posture-api-cep-hardening`이다. 정상 승인된 쓰기 인증이 확인된 뒤 이 브랜치만 일반 push한다.
force push·reset·clean·자동 merge·배포는 하지 않는다. 이 문서는 비밀값과 사용자 측정 데이터를 포함하지 않는다.

## 보존한 구현

원격 develop 기준점은 `953323477b49ffe80839bbfd1d9285ce8363a490`이다. 이번 문서 커밋 전 구현 HEAD는
`28feee2fbb758ef37ca1dfcf5f94c6c7fb75f4c4`이며 다음 3개 로컬 커밋을 포함한다.

- `164bae8ca0c00de0653ebab8d560798eb0a074ac`: develop 기능을 유지하며 저장·복구·동시 탭·카메라 준비/취소 안정성 보완.
- `c4a6a1b0eba656f10e1c697f8f2f37f7d69a8d68`: Mac polling watcher 지원 및 통합 검증 기록.
- `28feee2fbb758ef37ca1dfcf5f94c6c7fb75f4c4`: API 저장/조회, 별도 Esper 시간 사건 판정, FastAPI 합성 추론 수직 흐름과 회귀 검증.

과거 계획서의 기술 스택은 의무 요구사항이 아니다. 사용자는 문서가 형식상 작성됐다고 정정했다.
기존 구현은 보존하지만 Kafka/Redis/HDFS/Spark나 학습 모델을 문서만으로 추가하지 않는다.
기술 선택을 바꾸기 전 실제 제품 요구와 팀 합의를 확인한다.

## 이어 작업하는 방법

원격 브랜치가 실제 존재하고 SHA가 확인된 경우에만 클라우드 작업의 기준으로 사용한다.
아직 push하지 못했다면 클라우드에는 아래 구현 커밋이 없으므로 원격 develop을 완료본으로 취급하지 않는다.
복구 bundle은 Git 소스/이력만 포함한다. 의존성, 런타임, 브라우저 저장 데이터, 모델 가중치와 자격증명은 포함하지 않는다.

새 환경에서 Node 24+, Python 3.9+, JDK 21, Maven 3.6.3+를 준비한 뒤 실행한다.

```sh
git switch codex/posture-api-cep-hardening
make setup
make check
```

[실행 안내와 계약](../backend/README.md), [기획 대비 점검](audits/2026-09-30-mac-develop.md),
[API·CEP 완료 기록](plans/completed/0011-api-cep-vertical-slice.md)을 먼저 확인한다.
서비스 smoke는 합성 입력과 임시 loopback 포트만 사용하며 시작한 시험 서버를 종료한다.
수동 서버를 켰다면 작업 종료 시 직접 종료한다. 다른 프로젝트 서버는 실행하지 않는다.

## 확인된 검증과 한계

구현 HEAD `28feee2`에서 Mac 원본 경로의 `make check` 전체 통과:
Python 19개, 프론트 84개, Java 26개(API 10/CEP 16), 타입 검사·Vite 빌드·저장소 검사,
세 서비스 실제 HTTP 합성 흐름과 서버 종료/포트 해제 검사.
인계 문서 추가는 소스 동작을 바꾸지 않는다. 새 환경에서 위 검증을 다시 실행해야 한다.

실제 카메라/영상 전송, 음성 전달, 기기 지연·모델 정확도와 이번 서버 흐름의 브라우저 QA는 미검증이다.
프론트는 기존 로컬 저장/시간 엔진을 사용한다. 서버 모드와 연결하면 CEP 사건만 소비하도록 전환하여 시간 판정을 중복하지 않는다.
FastAPI 점수는 규칙 기반이며 학습 모델·보정 확률이 아니다. API 저장은 프로세스 메모리여서 재시작하면 사라진다.

## 다음 결정과 승인 범위

- 붕괴 3초/재알림 60초 기본값과 커스텀 설정을 보존했다. 정상 복귀 2초는 기존값이며 최종 결정은 남아 있다.
- 휴식 제외는 같은 세션의 붕괴 주기 통계에 적용했다. 휴식 후 알림 타이머 동결/재개는 별도 결정이다.
- 영구 저장·인증·사용자 격리·동의/삭제·재시작 복구는 미구현이다. 실제 외부 DB/비밀값이 필요하면 먼저 승인받는다.
- 실제 특징 어댑터·서버 연결과 학습/공개 데이터 도입은 별도 요구·승인·검증 후 진행한다.
- 영상/실제 좌표 전송, 카메라 권한, 새 자격증명, 보안 설정 변경, 배포는 이번 승인에 포함되지 않는다.
- 모델은 사용자 지침에 따라 6.1 sol을 사용하고 추론 수준은 난이도에 맞춘다.

## 원격 쓰기 장애

Mac Git의 `Dev-jisung` 계정은 이전 push에서 저장소 권한 403이 발생했다.
제한된 실행 환경의 인증 실패 표시는 정상 네트워크 경로에서 재확인했다.
`gh auth status`의 로그인은 유효하며, 저장소 읽기 API의 `permissions.push=false`로 Write 권한 부재를 확인했다.
연결 앱도 이전 쓰기 요청에서 `Resource not accessible by integration` 403이 발생했다.
반복 push나 다른 인증 경로를 통한 우회는 하지 않았다.

저장소 소유자가 현재 `Dev-jisung` 계정에 Write 권한을 부여하고 사용자가 초대를 수락해야 한다.
또는 이미 Write 권한이 있는 본인 계정으로 사용자가 `gh auth login -h github.com`을 직접 수행한다.
읽기 API에서 해당 계정의 저장소 `permissions.push=true`가 확인될 때까지 push를 보류한다.
Git CLI 인증과 앱 통합 권한은 별개다. 앱을 쓰려면 소유자의 해당 저장소 Contents 쓰기 권한 승인도 필요하다.
정상 쓰기 경로가 확인되면 다음 브랜치만 push하고 원격 SHA를 로컬 HEAD와 대조한다.

```sh
git push -u origin codex/posture-api-cep-hardening
git ls-remote --heads origin refs/heads/codex/posture-api-cep-hardening
```
