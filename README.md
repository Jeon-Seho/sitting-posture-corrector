# sitting-posture-corrector · PoseGood

웹캠 기반 개인 기준 자세 변화 알림 프로토타입. 레트로 에디토리얼 디자인의 React 18 앱 하나에서
로그인(프로필) → 측정 준비 → 실시간 측정 → 자세 등록 → 대시보드 → 설정을 모두 다룬다.
이 테스트 브랜치의 POSEGOOD 데스크톱 패키지는 **얼굴 추적 + 자체 시간 CNN + 개인 기준 머리 각도 참고 평가**를 사용한다.
일반 웹/Compose 경로의 기존 판정은 **MediaPipe Lite + 개인 기준 비교 규칙**이다.
Compose에서는 **MySQL + 이메일·비밀번호 계정 + 영구 기록·재시작 복구**를 사용한다.
측정 준비에서 개발용 서버 판정을 선택하면 기준 대비 세 특징 변화량을 Spring Boot API → FastAPI → Esper CEP로 전달한다.
기본은 로컬 판정이며 영상·원본 랜드마크는 전송하지 않는다. [서버 실행·경계·제약](backend/README.md).

## 테스트 버전 변경 이력

- 분야: 프론트, 머신러닝
- 작업: GP-0124, GP-0125
- 현재 패키지: **test_0.2.3 / POSEGOOD 0.2.3** (2026-10-07)
- POSEGOOD 본앱과 얼굴 실험 앱을 같은 버전으로 제작하고 모델 SHA 일치를 검사한다.
- 실제 사용 검증 후 `develop`에 반영하고, 그 다음 팀 DB·빅데이터 플랫폼을 연결하여 정식 버전을 준비한다.
  현재 테스트의 프로필·기록은 로컬에 저장한다.

| 버전 | 해결하려던 문제 | 적용한 변경 | 검증 범위와 남은 한계 |
| --- | --- | --- | --- |
| 0.1.0 | 화면 내 이동·자연스러운 동작과 지속 자세 이탈 구분 | 상대 특징 LSTM 실험과 Claude의 데스크톱·기록·팝업 작업 통합 | 실제 사용에서 고개 회전·스트레칭·어깨 누락에 취약했다. 실제 정확도 개선을 입증한 버전은 아니다. |
| 0.2.0 | 어깨가 안 보이는 상황과 얼굴 회전·동작 구분 | 독립 얼굴 추적, 선택적 어깨·손목과 누락 mask, 자세/행동 두 출력 시간 CNN. 학습·검증·시험 분리, 버전·모델 표시, 본앱 테스트 연결과 검토 자료 저장 | 제작 데이터 학습 및 추론 연결 검증. 실제 사람 오차율은 미측정이며 얼굴만 보일 때 몸 자세 평가는 보류했다. |
| 0.2.1 | 짧은 간격의 추가 프레임 때문에 준비 상태 반복 | 샘플링에서 제외한 추가 프레임에 직전 판정 유지. 실제 누락·시간 역전·긴 공백은 초기화. 입력 n/40·추적 속도·처리 ms·모델 실행 횟수 진단 추가 | 프론트305개 통과/1개 제외 및 패키지 검증. 실제 사용자에서 어깨 부족에 따른 전체 보류는 여전히 발생했다. |
| 0.2.2 | 어깨가 없어 하루 종일 측정 불가 표시 | 얼굴만 보이면 등록 머리 각도를 참고 평가. 머리/상체 시간·사건·기록 범위 구분, 실제 검출된 어깨에 선 표시. 얼굴만으로 forward/slouch 몸 자세를 확정하지 않음 | 프론트307개 통과/1개 제외. 어깨 없는 등록·어깨 관측 전환·이동·저장 검증. 머리 참고 평가와 몸 자세 정확도는 별개다. |
| 0.2.3 | 백그라운드 자동 정지, 얼굴 누락 뒤 수동 재개·약4초 준비 반복, 얼굴 잘림 입력 거부 | 백그라운드 처리 유지. 프레임 처리/얼굴 발견 분리, 얼굴 누락·일시 스케줄링 공백 제외 후 자동 재관측. 새40개를 모으는 동안 현재 머리 각도 참고 평가. 중앙 얼굴 근거가 있는 제한적 잘림 허용 | 프론트312개 통과/1개 제외. 패키지 최소화 중 추론·팝업 전달, 얼굴5초 누락 후 자동 복귀 검증. 여러 사람·큰 동작·장시간 실카메라 성능은 검수 대기다. |

### 모델 학습과 패치의 차이

0.2.0은 제작 시퀀스 학습6,400/검증1,600/시험1,600개로 **140 epoch, 최적105 epoch**를 실행했다.
분할 그룹은 실제 참여자60명이 아니라 생성 seed 그룹이다. 제작 자료 시험 오류율은
관측 가능한 자세1.0008%, 행동0.7792%이며 실제 사람의 오차율로 해석하지 않는다.
0.2.1~0.2.3은 같은 가중치를 사용한 입력 연결·평가 정책·앱 동작 패치다.
머리 각도 참고 평가는 등록 기준과 상대 회전을 사용하며 몸 전체 정상 자세나 거북목 판정을 뜻하지 않는다.
얼굴이 완전히 화면 밖인 구간은 평가에서 제외하고, 재관측 시 자동으로 이어간다.
실제 카메라 연결 해제·오류와 사용자가 선택한 휴식은 계속 일시정지한다.

### 0.2.3 검증 결과

- TypeScript, 얼굴/본앱 빌드, 두 앱 패키징, 버전·모델 SHA 및 설치 파일 SHA 검사 통과.
- 설치 본앱의 두 경로(얼굴만 등록 / 얼굴·어깨 등록 후 어깨 누락)에서 최소화10초간 모델 실행
  60→138회 / 100→169회, 백그라운드 팝업 전달, 얼굴5초 누락에도 세션 유지 확인.
- 재관측 후 머리 참고 평가 복귀688ms / 780ms, 위치 이동·휴식/재개100점 유지,
  사건0개·UI 오류0·범위별 기록 저장 확인. 새 동작 모델 판정에는 새40개 입력이 필요하다.
- 공개 사진과 합성 누락을 이용한 패키지 검증이며 실제 사람 정확도 시험은 아니다.
- 전체 `python tools/dev.py check`: Python169개 통과/1개 제외/기존 Windows 배포 오류3개로 중단.
  백업 파일 잠금2개와 Linux/POSIX 배포 잠금1개이며 전체 게이트 통과로 보고하지 않는다.

### 테스트 패키지 제작

자체 가중치·실제 자료·EXE는 Git에 포함하지 않는다. 모델이 준비된 환경에서:

```powershell
npm --prefix frontend ci
npm --prefix frontend run test:pack
```

모델이 없는 새 환경은 [얼굴 모델 학습·재현](docs/areas/machine-learning/face-motion-v020.md#학습과-재현)을 따른다.
`얼굴동작_모델학습.bat`은 학습 후 테스트 패치 버전을 올리고 두 앱을 함께 제작한다.
`test:pack`은 버전/모델 검사 → 얼굴 실험 앱 → 본앱 실행기/native/portable → 묶음 검증 순서로 실행한다.

| 결과물 | 경로 |
| --- | --- |
| POSEGOOD 빠른 실행기 | `frontend/PoseGood.exe` (아래 native 폴더와 함께 보관) |
| POSEGOOD native | `frontend/release/win-unpacked/PoseGood.exe` |
| POSEGOOD 단일 EXE | `frontend/release-portable/PoseGood.exe` |
| 얼굴 실험 단일 EXE | `frontend/release-face/PoseGood-Face-Lab-0.2.3.exe` |
| 버전·모델·빌드 기록 | `frontend/release-portable/test-pair.json` |

세부 근거: [얼굴 모델/패치 기록](docs/areas/machine-learning/face-motion-v020.md),
[관련 논문·공식 자료](docs/research/face-motion-literature.md),
[0.1.0 LSTM 실험](docs/areas/machine-learning/relative-pose-lstm.md).
아래 실행·Compose 설명은 일반 웹/기존 서버 경로의 안내다.

## Compose 계정 모드 실행

Docker Desktop/Engine과 Compose를 시작한 뒤:

```sh
make init-compose
docker compose up -d --build --wait --wait-timeout 180
```

[계정 앱](http://127.0.0.1:8080/)에서 가입한다. `docker compose down`으로 종료하면 DB 볼륨은 유지된다.
[실행·배포·백업](infra/README.md), [계정 API](contracts/accounts.v1.md),
[빅데이터 플랫폼 책임](docs/design/data-platform-boundary.md)을 참고한다.

## 로컬 프로토타입 실행

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
이 개발 명령은 메모리 모드다. 영구 저장과 실제 계정은 위 Compose 모드로 실행한다.

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
- 측정 종료 결과는 Compose에서 내 계정 DB에, 로컬 프로토타입에서 이 브라우저에 저장됨. 예시 표시를 끄면 실제 기록을 보여줌
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
전체 게이트에는 JDK 21·Maven·Chrome/Chromium·실행 중인 Docker/Compose도 필요하다. 실제 MySQL·계정 UI·재시작/삭제/백업 복원 검증이 포함된다. 프론트만 검증하려면 `make check-frontend`를 사용한다.
브라우저 검사는 `make check-frontend`로 프론트 빌드와 `make check-backend`로 JAR를 준비한 뒤 `make check-browser`로 따로 실행할 수 있다.
독립 임시 브라우저와 합성 입력을 사용하며 실제 카메라 권한이나 기존 브라우저 자료에 접근하지 않는다.

`make benchmark-server`는 준비된 JAR로 추론 단독·API→추론→CEP 지연과 처리량을 측정한다.
[측정 조건과 해석](docs/audits/2026-10-01-server-benchmark.md)을 확인한다. 실제 카메라 FPS와는 별도다.
[참여자 분할·시간 창 준비](docs/research/dataset-preparation.md)는 명시적 합성 예제로 바로 실행할 수 있다.
실제 자료의 수집·학습은 별도이며 출력은 Git 제외/외부 위치에 보관한다.
