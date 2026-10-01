# sitting-posture-corrector · PoseGood

웹캠 기반 개인 기준 자세 변화 알림 프로토타입. 레트로 에디토리얼 디자인의 React 18 앱 하나에서
로그인(프로필) → 측정 준비 → 실시간 측정 → 자세 등록 → 대시보드 → 설정을 모두 다룬다.
현재 프론트는 **MediaPipe Lite + 개인 기준 비교 규칙**이며 LSTM·DB·실제 인증은 연결되지 않았다.
측정 준비에서 개발용 서버 판정을 선택하면 기준 대비 세 특징 변화량을 Spring Boot API → FastAPI → Esper CEP로 전달한다.
기본은 로컬 판정이며 영상·원본 랜드마크는 전송하지 않는다. [서버 실행·경계·제약](backend/README.md).

## 실행

Node.js 24 이상, Python 3.9 이상에서:

```sh
make setup
make dev
```

`make`가 없는 Windows에서는 `python tools/dev.py setup`, `python tools/dev.py dev`를 사용한다.

[로컬 화면](http://127.0.0.1:5173/) → 이름·나이·직업 입력 → 측정 준비 → 카메라 켜기 → 5초 기준 등록 → 측정 시작.
실제 계정은 필요 없다. 프로필과 측정 요약은 이 브라우저(localStorage)에만 저장한다.
웹캠 권한을 지원하는 브라우저에서 실행한다.

개발 서버 모드는 JDK 21·Maven으로 `make check-backend`를 실행해 JAR를 준비한 뒤 `make dev-server`로 연다.
출력된 임시 포트 주소에서 측정 준비의 ‘서버 판정 사용’을 선택한다. 종료는 Ctrl+C다.
Windows에서는 `python tools/dev.py dev-server`를 사용한다. 서버 저장은 메모리이며 완료 요약은 브라우저에 보관한다.
인증·DB 연결은 [설계](docs/design/server-persistence-and-auth.md)까지만 정리했다.

## 화면 구성

| 메뉴 | 내용 |
| --- | --- |
| 홈 | 이 브라우저의 실제 기록(신규 기본) 또는 설정에서 선택한 발표용 예시 기록 |
| 측정 준비 → 실시간 측정 | 카메라 연결·5초 기준 등록 후 측정. `실시간 측정`은 준비·측정 중에만 보이는 하위 탭 |
| 자세 등록 | 여러 자세를 짧게 촬영해 관절 좌표 CSV로 내려받는 화면 (교정 알림 없음) |
| 대시보드 | 홈과 같은 기준(예시 / 실제 기록)으로 누적 기록 표시 |
| 설정 → 프로필 설정 | 판정 시간·임계값, `발표용 예시 기록 표시` 스위치. `프로필 설정`은 설정 아래 하위 탭 |

예전의 별도 연구 화면(`?research=1`)은 이 앱에 통합되어 더 이상 없다. [ADR 0008](docs/decisions/0008-single-app-entry.md) 참고.

## 동작

- 기본 3초 지속 후 이벤트·화면 알림, 60초 재알림 간격, 2초 정상 복귀 확인
- 휴식·측정 불가는 유효 시간에서 제외하고 연속 이벤트를 끊음
- 설정에서 시간·임계값 변경 가능 (모델 재학습 불필요, 다음 측정부터 적용)
- 측정 종료 결과는 이 브라우저에 저장되고, 예시 기록 표시를 끄면 홈·대시보드에 반영됨
- 카메라는 측정 준비에서 직접 켜고, 카메라가 필요 없는 화면으로 나가면 꺼짐 (측정 진행 중이면 유지)
- 영상·음성 저장/업로드 없음. 자세 등록은 관절 좌표 CSV로만 내려받으며 측정 통계와 분리됨

## 자세 등록 (좌표 수집)

`자세 등록` 메뉴에서 자세를 골라 5초 준비 후 촬영하고, 실제로 한 자세를 확인한 뒤 CSV로 내려받는다.
[수집 v2 지침과 pandas 분석](docs/research/guided-collection-v2.md)을 참고한다. 화면에 실제 추적 FPS·추론 시간이 표시된다.

## 구조와 개발

- [프론트 실행·사용·제약](frontend/README.md)
- [문서 지도](docs/index.md), [작업 지침](AGENTS.md), [개발 흐름](docs/development.md)
- [디자인 시스템](DESIGN.md), [제품 방향](PRODUCT.md), [서비스 요구사항](docs/team-requirements.md)
- [출력 계약](contracts/README.md), [연구 프로토콜](docs/research/protocol.md)
- [코드 구조와 수정 위치](docs/code-structure.md), [기술 스택 검토](docs/audits/2026-10-01-technology-stack.md)
- `frontend/src/app/ServiceApp.tsx`: 앱 조립·화면 전환
- `frontend/src/features/`: 프로필·세션·기록·저장·카메라 기능
- `frontend/src/lib/engine.ts`: 웹캠·시연 공통 세션 엔진의 공개 진입점
- `model/prototype/pose.ts`: 품질·정규화·개인 기준 비교

검증: `make check` (문서/구조, Python 계약·추론, 프론트 상태 전이·특징·통계, 타입/빌드, Java API/CEP, 합성 HTTP·브라우저 흐름).
전체 게이트에는 JDK 21·Maven과 Chrome/Chromium도 필요하다. 프론트만 검증하려면 `make check-frontend`를 사용한다.
브라우저 검사는 `make check-frontend`로 프론트 빌드와 `make check-backend`로 JAR를 준비한 뒤 `make check-browser`로 따로 실행할 수 있다.
독립 임시 브라우저와 합성 입력을 사용하며 실제 카메라 권한이나 기존 브라우저 자료에 접근하지 않는다.

`make benchmark-server`는 준비된 JAR로 추론 단독·API→추론→CEP 지연과 처리량을 측정한다.
[측정 조건과 해석](docs/audits/2026-10-01-server-benchmark.md)을 확인한다. 실제 카메라 FPS와는 별도다.
[참여자 분할·시간 창 준비](docs/research/dataset-preparation.md)는 명시적 합성 예제로 바로 실행할 수 있다.
실제 자료의 수집·학습은 별도이며 출력은 Git 제외/외부 위치에 보관한다.
