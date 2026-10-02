# 코드 구조와 수정 위치

2026-10-01에 기존 동작을 유지하면서 앱 조립, 기능별 상태·저장, HTTP, 추론, 시간 판정을 분리했다.
구조 정리는 프레임워크·라이브러리·버전·저장 키·기존 계약을 유지했다.
후속 서버 연결은 새 입력/응답 계약과 선택 필드·`dev-server` 명령을 추가했다([ADR 0013](decisions/0013-frontend-server-feature-connection.md)).
전체 저장소를 하나의 거대한 계층 구조로 재배치하지 않고 기존 frontend/backend/model/contracts 경계를 유지한다.

## 전체 지도

```text
frontend/src/
  app/                    앱 조립, 화면 이동, 사이드바, 저장소 안내
  features/
    accounts/             서버 로그인·프로필·원격 workspace·계정별 임시 자료
    dialog/               공통 확인창·키보드 초점과 동작 생명주기
    camera/               포즈 모델 준비, 프레임 처리, 카메라 오류 안내
    profile/              프로필 편집, 로컬 자료 삭제 확인
    session/              측정 화면, 결과·이벤트 표시, 저장·복구
      engine/             상태·시간 정책, 합성 시나리오, 화면 snapshot
      server/             서버 계약·순서 큐·복구·결과 투영·전용 화면
    history/              기록 조회·상세·비교 조건 안내
    storage/              저장 타입, 검증, 브라우저 IO, 기록 변환
    testing/              명시적 개발 테스트 모드의 합성 카메라·시계
  pages/                  측정 준비·수집·설정·로그인·발표용 예시 대시보드 화면
  components/             여러 화면에서 쓰는 UI·카메라 표시
  hooks/                  카메라·수집·세션·탭 잠금 React 연결
  lib/                    통계·표시·수집 도구와 기존 공개 진입점
  data/                   설정 기본값, 명시적인 합성 발표 자료
  styles/                 토큰·레이아웃·컴포넌트·화면별 스타일
  styles.css              기존 순서를 유지하는 스타일 import

backend/
  api/                    org.posegood.api
    .../web/              HTTP 입력과 오류 응답
    .../application/      세션 생성·관측·종료·조회 조정
    .../account/          인증·CSRF·현재 주체·계정/비밀번호 관리
    .../persistence/      JDBC 저장·JSON 검증·계정 잠금
    .../repository/       메모리 개발 저장
    .../gateway/          CEP·추론 HTTP 연결
  cep/                    org.posegood.cep
    .../web/              내부 HTTP 입력과 오류 응답
    .../application/      세션 생명주기·입력 순서·사건 처리 조정
    .../domain/           관측 시간 누적, 사건 기록·통계
    .../esper/            EPL 컴파일·런타임·판정 전달
    .../resources/rules/  시간 임계값 비교 EPL
  contracts/              Java 전송 타입과 입력 검증

model/
  prototype/              브라우저 특징·개인 기준 보정
  inference/              Python 추론 HTTP 경계와 규칙 점수
  analysis/               별도 CSV 연구 분석
    dataset/              명시적 설정·CSV 검증·참여자 분할·시간 창·산출물
database/migrations/      Flyway MySQL 스키마
infra/                    컨테이너 빌드·Nginx·배포 안내
compose.yaml              계정 모드 전체 서비스·private 네트워크·볼륨
contracts/                버전 있는 JSON Schema와 합성 예제
tools/                    실행·검증·시험 서버 관리
  browser/                Chrome CDP 연결·프로세스·합성 브라우저 시나리오
  benchmark/              합성 서버 HTTP·측정 집계·환경과 재현 manifest
tests/                    Python 계약·추론·저장소 검사
```

Java 트리의 `.../`는 각 모듈 `src/main/java/org/posegood/{api,cep}` 경로를 줄인 표시다.

## 프론트 수정 위치

| 바꿀 내용 | 시작할 파일 | 책임 |
| --- | --- | --- |
| 메뉴·화면 연결 | [앱](../frontend/src/app/ServiceApp.tsx), [탐색 정의](../frontend/src/app/navigation.ts) | 컨트롤러와 화면 조립. 개별 기능 내부 구현은 넣지 않는다. |
| 프로필 편집·삭제 확인 | [프로필 hook](../frontend/src/features/profile/useProfileForm.ts), [화면](../frontend/src/features/profile/ProfilePage.tsx) | 입력·저장·취소와 확인창을 구분한다. |
| 확인창 키보드·초점 | [공통 확인창](../frontend/src/features/dialog/ConfirmDialog.tsx), [초점 처리](../frontend/src/features/dialog/modalFocus.ts) | 취소 우선·native modal·Tab 순환·초점 복귀·중복 실행 차단 |
| 저장 실패·중단 복구 | [세션 저장 hook](../frontend/src/features/session/useSessionPersistence.ts) | 동일 결과 재시도, checkpoint, 종료·복구를 관리한다. |
| 측정 화면 생명주기·소리 | [화면 hook](../frontend/src/features/session/useSessionScreen.ts) | 화면 상태·입력 중단·알림 전달을 관리한다. 시간 분류는 엔진을 호출한다. |
| 실시간·종료 UI | [측정 화면](../frontend/src/features/session/SessionPage.tsx) | Live/Result를 선택한다. 각각의 UI와 사건 표시는 별도 파일이다. |
| 로컬 시간 정책 | [상태 기계](../frontend/src/features/session/engine/machine.ts) | 이탈 지속·복귀·재알림·집계 제외 정책. |
| 서버 측정 연결 | [컨트롤러](../frontend/src/features/session/server/controller.ts), [순서 큐](../frontend/src/features/session/server/queue.ts), [HTTP](../frontend/src/features/session/server/client.ts) | 실제 프레임 구간, 불변 요청·확인 응답·재시도·복구. 시간 조건은 CEP가 판정한다. |
| 서버 화면·결과 | [화면](../frontend/src/features/session/server/ServerSessionPage.tsx), [투영](../frontend/src/features/session/server/projection.ts) | 제공된 사건/통계만 표시하고 원래 snapshot을 보관한다. |
| 합성 시연·표시 값 | [시나리오](../frontend/src/features/session/engine/scenario.ts), [snapshot](../frontend/src/features/session/engine/snapshot.ts) | 합성 입력과 화면 보간을 시간 정책에서 분리한다. |
| 저장 형식·손상 검사 | [타입](../frontend/src/features/storage/types.ts), [검증](../frontend/src/features/storage/validation.ts) | localStorage 키와 기존 자료 호환성을 유지한다. |
| 저장 읽기·쓰기 | [저장소](../frontend/src/features/storage/localRepository.ts) | 원본 보존, 쓰기 전 검증, draft 보호를 담당한다. |
| 기록 집계·복구 변환 | [기록 함수](../frontend/src/features/storage/records.ts), [기록 화면](../frontend/src/features/history/LocalHistory.tsx) | 계산/변환과 React 표시를 분리한다. |
| 기록 상세·비교 조건 | [상세](../frontend/src/features/history/RecordDetails.tsx), [비교 조건](../frontend/src/features/history/ComparisonConditions.tsx) | 저장된 사건·설정과 출처/기준 차이를 표시하며 없는 자료는 추정하지 않는다. |
| 카메라 | [카메라 hook](../frontend/src/hooks/useCamera.ts), [카메라 기능](../frontend/src/features/camera/) | React 생명주기와 순수 처리/모델 어댑터를 구분한다. |
| 색·서체·간격 | [토큰](../frontend/src/styles/base.css), [스타일 진입](../frontend/src/styles.css) | import 순서는 기존 cascade와 같게 유지한다. |

`lib/engine.ts`, `lib/serviceStore.ts`는 기존 소비자에게 같은 API를 제공하는 작은 export 진입점이다.
새 기능을 이 파일에 다시 모으지 않는다. 서버 모드는 CEP 사건만 소비하고 프론트 시간 엔진을 실행하지 않는다.

## 서버·Python 수정 위치

| 바꿀 내용 | 위치 | 책임 |
| --- | --- | --- |
| 외부 HTTP | [API web](../backend/api/src/main/java/org/posegood/api/web/) | 요청 전달과 HTTP 오류 응답 |
| API 저장·조회 흐름 | [SessionService](../backend/api/src/main/java/org/posegood/api/application/SessionService.java) | CEP 응답 검증 후 snapshot 저장; 시간 조건 재판정 없음 |
| API 특징 추론 조율 | [FeatureProcessor](../backend/api/src/main/java/org/posegood/api/application/FeatureProcessor.java) | 추론 출력·요청 hash·미확인 CEP 재시도와 기준 고정 |
| CEP 입력·순서·종료 | [SessionEngine](../backend/cep/src/main/java/org/posegood/cep/application/SessionEngine.java) | 중복·역순·누락과 결정 적용 조정 |
| 시간 누적·사건 통계 | [domain](../backend/cep/src/main/java/org/posegood/cep/domain/) | 유효/제외 시간과 사건 이력; 시간 임계값 비교 없음 |
| 시간 조건 | [EPL](../backend/cep/src/main/resources/rules/posture.epl), [Esper 어댑터](../backend/cep/src/main/java/org/posegood/cep/esper/EsperDecisionRuntime.java) | 시간 임계값 비교는 EPL 하나에 유지 |
| FastAPI 앱 조립 | [app.py](../model/inference/app.py) | 앱 생성, 라우터·오류 처리 연결; 기존 `model.inference.app:app` 실행 유지 |
| 추론 계약·현재 점수·HTTP | [schemas.py](../model/inference/schemas.py), [service.py](../model/inference/service.py), [routes.py](../model/inference/routes.py) | 계약/점수/전달 분리; 학습 모델이나 시간 엔진이 아님 |
| 개발 명령 | [dev.py](../tools/dev.py), [dev_tasks.py](../tools/dev_tasks.py), [runtime.py](../tools/runtime.py) | CLI/작업 순서/실행 경로 분리 |
| 합성 HTTP 검증 | [service_smoke.py](../tools/service_smoke.py), [service_processes.py](../tools/service_processes.py) | 검증 시나리오와 시험 프로세스 시작·종료 분리 |
| 합성 브라우저 검증 | [browser](../tools/browser/), [합성 입력](../frontend/src/features/testing/) | 실제 앱/서버와 독립 시험 브라우저를 연결한다. 일반 개발·빌드는 합성 입력을 활성화하지 않는다. |
| 서버 지연 측정 | [benchmark](../tools/benchmark/) | HTTP 요청·성공/실패 집계·소스/환경 manifest를 분리한다. |
| 학습 자료 준비 | [dataset](../model/analysis/dataset/) | 참여자 분할 후 실제 시각·품질·라벨·구간 경계를 유지해 창을 만든다. |
| 서버 개발 실행 | [server_dev.py](../tools/server_dev.py), [frontend_proxy.py](../tools/frontend_proxy.py) | loopback 개발 프록시·세 서비스 실행과 전체 종료 감시 |

## 작성 원칙과 검증

- 함수는 한 책임을 담고, 분기·오류 처리·JSX·JSON·XML을 일반적인 여러 줄 형식으로 쓴다.
- 부작용이 있는 IO·React hook·HTTP 어댑터와 순수 계산을 구분한다.
- 새 파일은 기능이나 경계가 생길 때 만든다. 구현 하나를 감싸기 위한 인터페이스·중복 계층은 추가하지 않는다.
- 공유 타입은 실제 생산자 책임에 두고, 기능 모듈이 앱 화면 조립 코드에 의존하지 않게 한다.
- 기존 API·저장·시간 의미를 바꾸면 계약·합성 회귀 검증과 관련 결정을 함께 갱신한다.
- `.editorconfig`의 들여쓰기·개행을 따른다. 이번 포맷 도구는 임시 실행했으며 프로젝트 의존성에 추가하지 않았다.

기본 검증은 `make check`다. [품질 기준](quality.md),
[구조 변경 완료 기록](plans/completed/0012-readable-code-structure.md),
[기술 스택 조사](audits/2026-10-01-technology-stack.md)를 함께 확인한다.
