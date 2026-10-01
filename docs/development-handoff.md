# API·CEP 작업 인계

2026-09-30 인계 이력과 2026-10-01 후속 변경을 함께 기록한다. 협업 저장소이므로 **main/develop에 직접 push하지 않는다**.
현재 작업 브랜치는 `codex/posture-api-cep-hardening`이다. 정상 승인된 쓰기 인증이 확인된 뒤 이 브랜치만 일반 push한다.
force push·reset·clean·자동 merge·배포는 하지 않는다. 이 문서는 비밀값과 사용자 측정 데이터를 포함하지 않는다.

## 최신 작업 상태 (2026-10-01)

기존 구조/서버/도구 변경은 c4086f3을 현재 codex 브랜치에 push했다. 그 뒤 MySQL 계정·Compose 작업을 진행했다.
[계획 0017](plans/completed/0017-mysql-accounts-compose-deployment.md), [실행/배포 안내](../infra/README.md),
[계정 계약](../contracts/accounts.v1.md)이 현재 기준이다. 이전 절의 미구현/검증 수/쓰기 장애는 해당 시점 이력이다.
최신 MySQL 작업의 remote push·GitHub workflow·외부 배포는 아직 실행하지 않았다. 배포 서버는 사용자 확인으로 미정이다.
전체 make check는 Docker/Compose·JDK 21·Maven·Node 24·Python·Chrome을 필요로 한다.
문서 밖 사용자 임시 자료 docs/references/temp.md는 보존하고 변경/커밋 대상에 포함하지 않는다.

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

## 확정 시간 정책과 다음 결정

- [ADR 0012](decisions/0012-session-timing-policy.md)로 최초 알림 3초·정상 복귀 2초·같은 사건 재알림 60초를 확정했다(2026-10-01 사용자 재확인). 기존 커스텀 설정은 다음 새 세션부터 적용하며 진행·휴식 재개·복구 중인 세션 설정을 바꾸지 않는다.
- 휴식·자리 비움·측정 불가·누락은 열린 사건을 중단하고 연속 이탈·복귀 누적을 초기화한다. 제외 시간은 유효 통계에 넣지 않고 이후 새 사건은 다시 지속시간을 채운다. `legacy-interrupt-v1` 전송 식별자와 기존 구현을 유지한다.
- 영구 저장·인증·사용자 격리·동의/삭제·재시작 복구는 미구현이다. 실제 외부 DB/비밀값이 필요하면 먼저 승인받는다.
- 개발용 특징 어댑터·서버 연결은 사용자의 남은 작업 요청으로 아래 후속 범위에 구현했다. 학습/공개 데이터 도입은 별도 요구·검증 후 진행한다.
- 개발 특징의 단위·정규화·관측 구간은 ADR 0013을 따른다. 품질 임계값·정확도·장치 성능·카메라 시점의 연구상 확정은 남는다.
- 영상/실제 좌표 전송, 카메라 권한, 새 자격증명, 보안 설정 변경, 배포는 이번 승인에 포함되지 않는다.
- 모델은 사용자 지침에 따라 6.1 sol을 사용하고 추론 수준은 난이도에 맞춘다.

## 이전 원격 쓰기 장애

아래 403과 권한 안내는 이전 인계 시점의 이력이다. 2026-10-01 사용자의 현재 브랜치 push 요청으로
Git CLI를 재확인했으며 원격 브랜치 SHA는 로컬 기준 HEAD와 같고 `git push --dry-run`은 정상 종료했다.
현재 작업의 일반 push 결과와 최종 원격 SHA는 실행 뒤 대조한다. 연결 앱 권한은 이번에 재검증하지 않았다.

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


## 2026-10-01 후속 구조 정리

현재 작업 폴더에는 앱 조립·기능별 상태/저장·측정 UI, API 계층·CEP 누적/Esper,
Python 추론·개발 도구를 책임별로 분리한 후속 변경이 있다. 기존 동작·계약·스택은 유지했다.
현재 수정 경로는 [코드 지도](code-structure.md), 검증 근거는
[완료 기록](plans/completed/0012-readable-code-structure.md), 기술 검토는
[스택 조사](audits/2026-10-01-technology-stack.md)를 따른다.
`make check` Python 19개·프론트 85개·Java 26개·타입/빌드·합성 HTTP와 시험 서버 종료를 통과했다.
앞의 구현 HEAD/원격 쓰기 장애 설명은 9월 30일 인계 시점의 이력이다.

## 2026-10-01 서버 연결

사용자는 DB·로그인 환경이 없으므로 서버 연결부터 선택했다. 기술 스택·의존성을 유지하고
[특징 입력 v2·프론트 서버 연결](decisions/0013-frontend-server-feature-connection.md)을 구현했다.
브라우저의 세 변화량/품질 → API `/features` → FastAPI `/v2/infer` → CEP → 관측+조회 응답을 사용한다.
서버 측정은 CEP 사건만 투영하며 로컬 시간 엔진을 마운트하지 않는다. 기본 로컬 모드와 과거 저장 자료를 유지한다.

`make check-backend`로 JAR 생성 후 `make dev-server`를 실행하고 출력된 임시 포트에서 서버 판정을 선택한다.
종료는 Ctrl+C이며 자신이 실행한 프론트·세 서비스만 정리한다. 수동 설정은 loopback API만 허용한다.
정확히 같은 미확인 요청 재전송, 순서/기준 고정, 저장 실패 시 송신 중단, 수동 재개·종료 응답 대기,
새로고침 GET 확인과 서버 유실 표시를 구현했다. 완료 요약은 여전히 브라우저에 보관한다.
원래 서버 사건/통계와 모델/기준 ID를 남기며 서버 종료 미확인 요약은 성공 기록과 구분한다.

실제 Vite 프록시+API+추론+CEP HTTP 합성 흐름과 의존성 실패·중복·제외/종료 정책을 검증했다.
DB·인증은 [연결 설계](design/server-persistence-and-auth.md)만 작성했다. 서버 재시작 후 영구 복구,
사용자 격리·동의/삭제·실촬영·장시간·기기 성능·학습 모델은 미구현 또는 미검증이다.
세션당 10,000개 관측 제한이 있어 장시간 측정용으로 배포하지 않는다.

서버 연결 시점의 `make check`: Python 35개·프론트 166개·Java 49개(API 33/CEP 16), 타입 검사·Vite/JAR 빌드,
실제 프록시+세 서비스 HTTP와 시험 서버 종료 모두 통과했다. 합성 프로필 브라우저 준비/선택 UI도 확인했다.
[완료 범위와 검증 한계](plans/completed/0014-frontend-server-connection.md)를 다음 작업의 기준으로 사용한다.

## 2026-10-01 서버 회귀·기록 화면 후속

서버 전체 HTTP의 재알림 경계·처리 후 응답 유실, CEP 개발 한도·종료, 개발 프로세스 정리 회귀를 추가했다.
기록 상세는 원래 서버 사건의 방향·중단 사유·제외 구성과 적용 설정을 표시한다. 비교에는 실제 첫/최근 구간의
출처·설정·모델·기준 차이와 누락 정보를 표시하며 기존 합산/제외 정책은 유지한다.

`make check-browser`를 전체 `make check`에 연결했다. 새 환경에는 설치된 Chrome/Chromium도 필요하다.
일반 앱을 사용하는 명시적 개발 합성 입력과 독립 임시 브라우저로 실제 API·추론·CEP를 검증한다.
직접 실행에는 프론트 프로덕션 빌드와 JAR가 필요하다. 카메라 권한·실제 자료·의존성 변경은 없다.

당시 전체 `make check`: Python 50개·프론트 182개·Java 51개(API 33/CEP 18), 타입·Vite/JAR 빌드,
실제 HTTP·합성 브라우저 40개와 모든 시험 프로세스/포트 정리를 통과했다. 이후 확정 사건을 포함한
새로고침 알림 회귀를 보강하고 `make check-browser` 대상 재검증 40개도 통과했다.
원격 CI와 Windows/Linux 브라우저 실행은 미검증이며 실제 촬영·음향·장시간·지연/FPS는 별도다.
[완료 기록](plans/completed/0015-server-regression-and-record-details.md)에 당시 범위를 기록했다.

## 2026-10-01 확인창·성능 측정·자료 준비 후속

공통 native 확인창으로 취소 초기 초점, Tab/Shift+Tab 순환, Esc·배경 클릭 취소, 배경 조작 차단을 구현했다.
확인 작업 중 중복 제출을 차단하고 실패하면 오류와 재시도를 제공한다. 보관·탈퇴 후 열기 버튼이 사라지는 경우도
화면 갱신 뒤 새 주영역으로 초점을 옮긴다. 실제 Chrome에서 기존 초점 복귀 실패를 재현하고 수정했다.

`make benchmark-server`는 합성 입력의 추론 단독과 API→추론→CEP 지연·처리량·실패를 측정한다.
동시 1개/2개 실행에서 경로별 100개 요청이 모두 성공했다. 실행 환경·코드/JAR/입력 hash와 수치는
[측정 기록](audits/2026-10-01-server-benchmark.md)에 남겼다. 실제 카메라/FPS나 배포 성능 보장은 아니다.
CEP의 최초 요청 준비가 API 기한에 영향을 주는 문제를 서비스 시작 때 준비하도록 수정했다.
준비는 사용자 세션/관측을 남기지 않으며 64세션 용량·최초 생성·중복 요청을 검증했다.

[자료 준비 CLI](research/dataset-preparation.md)는 명시적 설정으로 참여자 분할을 먼저 정하고 품질·라벨·누락·기준 경계에서
시간 창을 끊는다. 기준 등록 자료는 평가 창과 분리하고 시험 참여자는 fit/tuning에서 제외한다.
결과 폴더를 배타적으로 확보하고 완료 manifest를 마지막에 기록하여 동시 실행 결과를 덮어쓰지 않는다.
합성 예제는 train/validation/test 각 2개 창과 기준 등록 3개로 검증했다. 실제 자료와 학습은 사용하지 않았다.

계획 0016 당시 전체 `make check`: Python 93개·프론트 189개·Java 53개(API 33/CEP 20), 타입 검사·Vite/JAR 빌드,
실제 HTTP·짧은 benchmark·합성 입력의 실제 Chrome 회귀 61개와 모든 시험 프로세스/포트 정리가 통과했다.
실제 카메라·음향·장시간·기기 FPS·학습 정확도, 외부 DB/인증 연결, 원격 CI와 Windows/Linux 실행은 미검증이다.
기술 스택·의존성·확정 판정 정책은 유지했다. [완료 기록](plans/completed/0016-remaining-tools-and-validation.md)과
[백로그](plans/backlog.md)를 다음 작업의 기준으로 사용한다.


## MySQL 작업 최종 검증

최신 전체 make check exit 0: Python122·프론트228·기본Java69(API45/CEP24), TypeScript·Vite/JAR,
실제 HTTP·benchmark·기존 Chrome61과 계정 Chrome21, 실제 Compose46, 원본/복원 MySQL11개씩 통과.
백업의 별도 빈 DB 복원·row counts·볼륨 재마운트·Flyway validate·시험 자원 정리를 확인했다.
[완료 기록0017](plans/completed/0017-mysql-accounts-compose-deployment.md)이 최신 기준이다.
Docker Desktop의 Desktop bind 권한 문제는 검증용 외부 임시 secret로 해결했다. 일반 실행의 외부 지속 경로는
[infra 안내](../infra/README.md)를 따른다. 현재 앱 서비스는 실행 중이 아니며 시험 자원은 정리했다.
최신 변경의 remote push·GitHub workflow·외부 배포와 실제 카메라/연구 정확도/Windows host는 미검증이다.
