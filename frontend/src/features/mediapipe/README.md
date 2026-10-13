# MediaPipe Pose 개발 진입점

MediaPipe 모델 준비·원본 좌표 선택·추론 주기를 카메라 화면에서 분리한 브라우저 모듈이다.
React·canvas·저장소·자세 판정에 의존하지 않는다. SDK 패키지 직접 import는 `detector.ts` 한 곳에만 있다.

## 수정 위치

| 수정할 내용 | 파일 |
| --- | --- |
| Lite/Full/Heavy 모델·버전·해시 | [모델 자산](../../../model-asset.json) |
| SDK 옵션·자산 경로·관측 만료 시간 | [설정](config.ts) |
| GPU 우선·CPU fallback·SDK 호출 | [추적기](detector.ts) |
| 추출할 점·원본 결과 변환 | [좌표 선택](landmarks.ts) |
| 추론 간격·프레임 중복 제외·FPS | [추론 루프](tracking.ts) |
| 모듈 입출력 타입 | [타입](types.ts), [공개 진입점](index.ts) |
| A/B/C 좌표 특징·개인 기준 비교 | [모델 특징 경계](../../../../model/prototype/) |
| 스켈레톤 평활화·그리기 | [카메라 표시 어댑터](../camera/frameLoop.ts) |
| 기준 등록·원본 자료 저장 연결 | [카메라 hook](../../hooks/useCamera.ts), [별도 저장소](../camera/baselineArchive.ts) |

## 입출력과 연결

```text
video → createPoseTracker / startPoseTracking → PoseFrame (원본 13점)
                                              ↓
                           camera/frameLoop → model/prototype 특징
                                              ↓
                                    useCamera.subscribe
                                 측정 / 기준 등록 / CSV 수집
```

`PoseTracker.detectFrame(video, timeMs)`는 영상/world의 원래 index 0–12를 복사해서 내보낸다.
출력은 timeMs, videoTimeMs, landmarks, worldLandmarks, inferenceMs, delegate, width, height다.
timeMs는 호출자 시계의 밀리초, videoTimeMs는 해당 영상 프레임 시각의 밀리초다.
원본은 평활화·품질 필터링·보간하지 않는다. 검출 없음은 빈 배열이며 world 미제공도 빈 배열이다.
추적기가 추정한 33개 중 13개만 남기는 것이며 추론 자체는 전신 모델이다.

`startPoseTracking`은 새 영상 프레임만 처리하고 관측 간격·측정 만료·메트릭을 callback으로 전달한다.
`onTick`은 같은 시계에서 표시 소비자를 호출하기 위한 선택 callback이며 모듈은 그리기를 하지 않는다.
추론이나 onFrame 소비자가 실패하면 루프를 중단하고 onError를 호출한다.
반환된 stop은 타이머만 중단한다. 생성자는 모델 close와 카메라 스트림 종료를 담당한다.
연결 취소 token이 바뀌면 늦게 준비된 모델을 버리고 닫는다.

모듈 분리는 소비자의 판정·품질·3초 기준 등록·저장 형식을 바꾸지 않는다.
lee_app1 반영 후 소비자는 귀 기반 offset·turn 회전 제외 규칙과 좌표 중심 수집 CSV v3를 사용한다. 기준 JSON은 별도 형식으로 유지한다.
13점의 A/B/C 특징 계산과 통합 점수는 아직 구현하지 않았다. [비교 결정](../../../../docs/decisions/0023-baseline-feature-comparison.md)에 따라
원본 PoseFrame과 기준 시계열을 `model/prototype/`의 순수 변환기에 넣는 후속 단계다.
낮은 품질 관측은 정상/이탈로 추정하지 않고 기존 소비자에서 측정 불가로 처리한다.

## 검증

전체 프론트: `python tools/dev.py check-frontend`.
개발 중 합성 모듈·hook 테스트: `npm --prefix frontend run test -- src/features/mediapipe src/hooks/useCamera.test.tsx`.
SDK는 테스트에서 합성 출력으로 대체하며 실제 영상이나 모델 가중치를 fixture로 추가하지 않는다.
