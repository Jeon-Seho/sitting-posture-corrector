# Developer Lab

`/dev`와 `/dev/`의 카메라 중심 연구 작업 공간. 일반 서비스 `/` 및 `/#forecast`와 분리한다.
단일 Vite 프로젝트의 지연 로딩 경로이며 별도 서버/권한 관리용 관리자 화면은 아니다.

## 소유 경계

| 모듈 | 책임 | 서비스와의 관계 |
| --- | --- | --- |
| `DeveloperRoute.tsx` | 경로 진입·숨겨진 입력 video·세션 조립 | `ServiceApp`에서 지연 로딩 |
| `DeveloperLab.tsx`, `developer.css` | 다크/라이트 작업 공간·결과·기록·설정 | 개발 화면 전용 |
| `DeveloperCameraStage.tsx`, `camera-stage.css` | 큰 영상·정렬 가이드·관측/기준 겹침·안내 전환 | 개발 화면 전용 |
| `useDeveloperSession.ts` | 카메라 연결·안내·구도 확인·등록·실험 수명 | 서비스 등록/저장 호출 없음 |
| `session.ts` | 수치 집계·명시적 합성 입력·진단 export | `developer-lab-export-v1` 전용 |
| `alerts.ts` | 코어의 지속 이탈 후보 소비·사건별 중복 방지·60초 재알림·알림 스냅샷 | 새 자세 판정 없음, 개발 화면 전용 |
| `alertAudio.ts` | 사용자 동작으로 Web Audio 준비·짧은 소리·중단/해제 | 외부 음원·추가 패키지·OS 알림 없음 |
| `types.ts` | UI와 실험 어댑터의 데이터 경계 | 외부 서비스 계약 아님 |
| `model/prototype/developerGuidance.ts` | 화면 구도 기하 및 표시용 기준 변화 | 연구용 순수 함수 |
| `model/prototype/forecast.ts` | 기준·예측·실험 시간 정책 | 기존 연구 코어 재사용 |

공통 `useCamera`와 MediaPipe 관측 인터페이스는 소비만 한다. `camera.calibrate`,
서비스 store·계정·CEP·알림·기준 archive를 호출하지 않는다. 개발 테마는 `.dev-lab` 안에만
적용하고 일반 서비스 CSS에 토큰을 넣지 않는다. 실험 기록은 최대 8개 탭 메모리에만 남는다.
가이드 live/reference 좌표와 영상 스트림은 메모리에만 있고 기록·내보내기에 포함하지 않는다.

## 실행·검증

```sh
npm --prefix frontend run dev
# http://127.0.0.1:5173/dev
make check-frontend
```

UI의 합성 데모는 카메라 권한 없이 가이드와 실험 흐름을 확인한다. 실제 장치의 FPS·조명·구도·
모델 정확도 검증으로 해석하지 않는다. 로컬 `research-model/forecast.json`이 유효하면 LSTM을
기본 선택하고, 없으면 마지막 위치 유지 비교군을 사용한다. 설정에서 실제 모델 JSON을 수동으로
연결해도 LSTM을 선택한다. 명시적으로 선택한 비교군과 실행 중인 실험은 자동 변경하지 않는다.
별도 Face Landmarker 또는 영상 저장 기능은 없다.
개발 중 Fast Refresh가 실행을 해제하면 시작 대기로 초기화한다. 이전 관측을 현재 결과로 유지하지 않는다.
영상 점선은 등록 당시 화면 위치이며 3D 자세 판정 거리는 어깨 중심·폭으로 정규화한 별도 수치다.

## 개발자 알림 경계

알림 기준은 기본 `predictor`(선택한 예측 + 거리·시간), 선택 가능한 대조군은 `rule`(거리·시간만)이다.
실행 전에만 변경하고 실행에 고정한다. `DeveloperAlertTracker`는 선택한 코어의
`persistent_deviation_candidate`를 받아 최초 한 번과 60초 간격의 재알림만 결정한다.
`recovery_pending` 중 재이탈은 같은 사건이며 `near_reference`에서 사건을 끝낸다.
측정 불가·프레임 누락은 관측 연속성을 끊고 알림 사건도 초기화한다. 정상 복귀로 기록하지 않는다.
관측 간격이 유지되고 코어의 `ruleState`가 같은 지속 이탈/복귀 확인 사건을 유지하는 `warming`은
알림 발생만 억제하고 기존 사건·최대 거리를 보존한다. 예측 준비 완료를 새 최초 알림으로 만들지 않는다.

코어의 조건은 거리 12% 진입/8% 복귀, 룰 3초, 예측+룰 3초 이탈과 1초 낮은 오차 또는 5초 이탈,
지속 이탈 뒤 3초 복귀다. 거리는 정규화한 3D 얼굴 9점·귀 2점·어깨 2점의 그룹 평균이다.
알림부에서 임계값이나 행동 분류를 다시 만들지 않는다. LSTM은 300ms 좌표 예측이고 스트레칭
분류기가 아니다. 높은 예측 오차만으로 일시적 동작을 확정하지 않으며 실제 복귀를 확인해야 한다.
오래 유지한 스트레칭은 알림을 유발할 수 있다. 근거는 [ADR 0025](../../../../docs/decisions/0025-local-forecast-experiment.md)다.

`DeveloperAlertAudio.arm()`은 시작·소리 켜기·테스트 같은 사용자 클릭 안에서만 호출한다.
`beep()`는 이미 준비된 컨텍스트에만 전달하고 차단 상태를 자동으로 재개하지 않는다.
음소거·종료 때 `cancel()`로 예약 소리와 미완료 준비를 취소하고, 훅 해제 때 `dispose()`로 닫는다.
해제된 인스턴스는 재사용하지 않으므로 React StrictMode의 해제 후 재설정에도 새 인스턴스를 준비한다.
음소거·차단 여부는 알림의 시각 표시와 기록을 중단하는 조건이 아니다.

메모리 기록의 선택적 `alerts`는 최근 100개 스냅샷을 오래된 순으로 보관한다.
`alertCount`는 잘린 기록과 재알림을 포함한 전체 실행 알림 수, `alertSettings`는 실행에 고정한
`basis`/`reminderMs`다. 스냅샷에 원본 좌표·기준 윤곽·영상·가중치를 넣지 않는다.
수동 JSON에는 [명시된 필드](../../../../contracts/developer-lab-export.v1.md)만 내보낸다.
음소거 상태에서 남은 알림 수는 소리가 실제로 재생된 횟수를 뜻하지 않는다.

## 서비스로 옮길 때

1. 이 디렉터리를 서비스 화면에서 직접 import하지 않는다. 필요한 순수 표시 컴포넌트나 변환기만
   공통 디렉터리로 추출하고 입력·출력·수명·스타일 범위를 명시한다.
2. 가이드 구도와 연구 시간 임계값은 서비스 정책으로 자동 승격하지 않는다. 장치·시점·대상
   조건을 적은 검증 결과와 ADR을 마련하고 서비스 계약과 맞춘다.
3. 서비스의 측정 불가·기준 등록·저장·세션 복구·권한·중단 테스트를 추가해 회귀를 확인한다.
4. 두 화면이 같은 공통 컴포넌트를 소비하도록 전환한 뒤 개발 전용 코드를 정리한다.
   연구 demo·LSTM 파일 import·진단 export는 서비스로 함께 복사하지 않는다.

[화면 및 수치](../../../../docs/design/developer-lab.md),
[의존성 기록](../../../../docs/design/developer-lab-dependencies.md),
[가이드 결정](../../../../docs/decisions/0026-developer-camera-guidance.md).
