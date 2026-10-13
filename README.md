# sitting-posture-corrector · PoseGood

웹캠 기반 개인 기준 자세 변화 알림 앱. 데스크톱 화면의 React 앱 하나에서
로그인·회원가입 → 측정하기(자세 등록 포함) → 기록 → 설정을 다룬다.

- **판정은 서버가 한다**([ADR 0021](docs/decisions/0021-app-sends-information-server-judges.md)). 앱은 관절 9개 좌표를 0.5초 구간으로 BE 입출구 서버(`/v2/realtime`)에 보내고 결과를 표시한다. 영상은 보내지 않는다.
  계약은 [연동 명세](docs/design/api-ws-spec.md)와 [WebSocket v2](contracts/realtime/realtime-ws.v2.schema.json)다. 앱을 v2로 바꾸는 일은 [계획 0023](docs/plans/active/0023-frontend-server-only.md)에서 한다.
- **지금 앱은 서버 연결 전 단계다.** 로그인·회원가입·기록은 이 기기에서 다루고(2026-10-13 예전 계정 모드 삭제), 판정은 브라우저 규칙(MediaPipe Lite + 개인 기준 비교) 또는 개발용 서버(v1, 특징 변화량)로 한다. 학습된 LSTM은 미연결이다.

## Compose 실행 (서버 개발용)

Docker Desktop/Engine과 Compose를 시작한 뒤:

```sh
make init-compose
docker compose up -d --build --wait --wait-timeout 180
```

`docker compose down`으로 종료하면 DB 볼륨은 유지된다. 앱의 계정 화면은 2026-10-13 지웠다(로그인·가입은 입출구 서버 `/v2/auth`가 생기면 다시 붙인다).
[실행·배포·백업](infra/README.md), [계약](contracts/README.md),
[빅데이터 플랫폼 책임](docs/design/data-platform-boundary.md)을 참고한다.

## 로컬 프로토타입 실행

Node.js 24 이상, Python 3.9 이상에서:

```sh
make setup
make dev
```

`make`가 없는 Windows에서는 `python tools/dev.py setup`, `python tools/dev.py dev`를 사용한다.

[로컬 화면](http://127.0.0.1:5173/) → 회원가입(① 약관 동의 C1~C6 ② 계정 정보 ③ 자세 등록, 선택) → 측정하기 → 카메라 켜기 → (등록한 자세가 없으면) 3·2·1 뒤 3초 등록 → 측정.
다음부터는 로그인 화면에서 들어간다. 서버 연결 전이라 입력값은 확인하지 않고 이 기기에 가입한 프로필로 들어간다.
프로필·동의 선택·측정 요약은 이 브라우저(localStorage)에만 저장하고 비밀번호는 저장하지 않는다. 등록한 자세는 이 PC에 카메라별로 저장한다.
웹캠 권한을 지원하는 브라우저에서 실행한다.

개발 서버 모드는 JDK 21·Maven으로 `make check-backend`를 실행해 JAR를 준비한 뒤 `make dev-server`로 연다.
출력된 임시 포트 주소에서 측정하기 준비 화면의 ‘서버 판정 사용 · 개발 연결’을 선택한다. 종료는 Ctrl+C다.
Windows에서는 `python tools/dev.py dev-server`를 사용한다. 서버 저장은 메모리이며 완료 요약은 브라우저에 보관한다.
이 개발 명령은 메모리 모드다(v1, 특징 변화량). 앱이 v2로 바뀌면 BE 입출구 서버에 붙인다.

## 화면 구성

| 메뉴 | 내용 |
| --- | --- |
| 측정하기 | 카메라 연결 → 얼굴·어깨 확인 → (등록한 자세가 없으면) 3·2·1 뒤 3초 자세 등록 → 측정이 스스로 시작. 등록한 자세가 있으면 카메라 화면의 「측정 시작」으로 바로 시작한다. 등록한 자세는 이 PC에 등록한 카메라와 함께 저장한다(2026-10-13). 「다시 등록」은 이 화면 위쪽과 설정에 있다. 측정은 앱의 다른 화면으로 이동해도 계속된다 |
| 기록 | 이 기기의 실제 기록(신규 기본) 또는 개발자 옵션에서 선택한 발표용 예시 기록의 누적 표시 |
| 설정 | 판정 시간·임계값. `개발자 옵션`에 `발표용 예시 기록 표시` 스위치와 `자세 데이터 수집`(관절 좌표 CSV, 교정 알림 없음) |
| 계정 메뉴(사이드바 하단) | 프로필 설정, 로그아웃 |

화면 구성은 [ADR 0017](docs/decisions/0017-desktop-app-shell-and-redesign.md)(2026-10-02) 기준이다. 10/12에 따로 만든 「자세 등록」 탭은 10/13 측정하기로 합쳤다.
이전 이름: 홈·측정 준비·실시간 측정 → 측정하기, 대시보드 → 기록, 예전 자세 등록(좌표 수집) → 설정의 자세 데이터 수집.

예전의 별도 연구 화면(`?research=1`)은 이 앱에 통합되어 더 이상 없다. [ADR 0008](docs/decisions/0008-single-app-entry.md) 참고.

## 동작

- 기본 3초 지속 후 이벤트·화면 알림, 60초 재알림 간격, 3초 정상 복귀 확인([ADR 0012](docs/decisions/0012-session-timing-policy.md), 2026-10-06 2초 → 3초)
- 휴식·측정 불가는 유효 시간에서 제외하고 연속 이벤트를 끊음
- 설정에서 시간·임계값 변경 가능 (모델 재학습 불필요, 다음 측정부터 적용)
- 측정 종료 결과는 지금 이 브라우저에 저장됨(서버 연결 뒤에는 서버가 저장하고, 5분 미만 측정은 저장하지 않음). 예시 표시를 끄면 실제 기록을 보여줌
- 카메라는 측정하기에서 직접 켜고, 카메라가 필요 없는 화면으로 나가면 꺼짐 (측정 진행 중이면 유지)
- 영상·음성 저장/업로드 없음. 자세 등록은 관절 좌표 CSV로만 내려받으며 측정 통계와 분리됨

## 자세 데이터 수집 (좌표 수집)

설정 › 개발자 옵션의 `자세 데이터 수집`에서 자세를 골라 5초 준비 후 촬영하고, 실제로 한 자세를 확인한 뒤 CSV로 내려받는다.
[수집 v2 지침과 pandas 분석](docs/research/guided-collection-v2.md)을 참고한다. 화면에 실제 추적 FPS·추론 시간이 표시된다.

## 구조와 개발

- [프론트 실행·사용·제약](frontend/README.md)
- [문서 지도](docs/index.md), [작업 지침](AGENTS.md), [개발 흐름](docs/development.md)
- [디자인 시스템](DESIGN.md), [제품 방향](PRODUCT.md), 서비스 요구사항은 팀 구글 시트
- [출력 계약](contracts/README.md), [연구 프로토콜](docs/research/protocol.md)
- [코드 구조와 수정 위치](docs/code-structure.md)
- `frontend/src/app/ServiceApp.tsx`: 앱 조립·화면 전환
- `frontend/src/features/`: 프로필·세션·기록·저장·카메라 기능
- `frontend/src/lib/engine.ts`: 웹캠·시연 공통 세션 엔진의 공개 진입점
- `model/prototype/pose.ts`: 품질·정규화·개인 기준 비교

검증: `make check` (문서/구조, Python 계약·추론, 프론트 상태 전이·특징·통계, 타입/빌드, Java API/CEP, 합성 HTTP·브라우저 흐름).
전체 게이트에는 JDK 21·Maven·Chrome/Chromium·실행 중인 Docker/Compose도 필요하다. 실제 MySQL·계정 UI·재시작/삭제/백업 복원 검증이 포함된다. 프론트만 검증하려면 `make check-frontend`를 사용한다.
브라우저 검사는 `make check-frontend`로 프론트 빌드와 `make check-backend`로 JAR를 준비한 뒤 `make check-browser`로 따로 실행할 수 있다.
독립 임시 브라우저와 합성 입력을 사용하며 실제 카메라 권한이나 기존 브라우저 자료에 접근하지 않는다.

`make benchmark-server`는 준비된 JAR로 추론 단독·API→추론→CEP 지연과 처리량을 측정한다.
측정 조건과 해석은 [아키텍처](docs/architecture.md) "합성 브라우저 검증 경계" 절을 따른다. 실제 카메라 FPS와는 별도다.
[참여자 분할·시간 창 준비](docs/research/dataset-preparation.md)는 명시적 합성 예제로 바로 실행할 수 있다.
실제 자료의 수집·학습은 별도이며 출력은 Git 제외/외부 위치에 보관한다.
