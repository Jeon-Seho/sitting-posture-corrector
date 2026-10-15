# 0037: 개발 전용 얼굴 추적과 동일 영상 비교

- 날짜: 2026-10-15
- 상태: 채택 (/dev 비교, 안경별 정확도 미검증)
- 관련: [작업 기록](../plans/completed/0051-face-landmarker-comparison.md), [공개 자료 재검토](../ml/face-and-public-data.md)

안경 착용 때 Pose 얼굴 점이 위에 보인다는 사용자 관찰로 Face Landmarker v1을 추가한다.
현재 설치된 `@mediapipe/tasks-vision` 1.0.1을 재사용하며 새 npm 의존성은 없다. 공식 Face 모델은
`frontend/face-model-asset.json`의 URL·SHA-256으로 검증하고 Git 제외 자산 경로에만 저장한다.
Face는 478점 중 눈·코·입 윤곽을 표시한다. Face / 기존 Pose / 겹쳐 보기로 같은 카메라 영상을 비교한다.
실제 비교 후 사용자가 Face를 기본 얼굴 추적기로 선택했다. Face 모드에서는 기존 Pose 얼굴과 과거 Pose 얼굴 기준선을 숨기고 어깨만 유지한다. 기존 Pose 얼굴은 비교 모드에서만 보인다. Face의 별도 기준 자세가 등록됐다는 뜻은 아니다.

별도 Worker에서 GPU를 먼저 준비하고 실패하면 CPU로 전환해 실제 delegate를 표시한다.
이 SDK의 module Worker에서는 WASM `ModuleFactory`가 설정되지 않는 것을 실제로 확인했다.
준비 스크립트가 IIFE Worker를 로컬 번들하며 classic Worker의 importScripts로 로컬 WASM을 읽는다.
실제 영상은 네트워크로 전송하지 않는다. 공식 [SDK 안내](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)는 동기 추론의 주 스레드 차단과 Worker 사용을 설명한다.

한 번에 한 프레임만 복사·전송하고 최대10Hz로 제한한다. 모델 준비20초·응답3초 watchdog,
500ms 표시 만료를 둔다. 종료·취소 시 Worker와 늦은 bitmap을 폐기한다. 누락을 이전 얼굴 좌표로 메우지 않는다.
Face 코와 Pose 코가 등록 어깨폭의 절반보다 멀면 다른 대상일 가능성이 있어 Face 표시·짝짓기를 제외한다.
이는 개발 대상 일치 필터이며 신원 인증이나 실제 품질 확률이 아니다.

비교는 동일 영상 시각(1ms 오차 이내)·동일 해상도의 코·근사 눈 중심·입 양끝을 이용한다.
눈/입 좌우는 영상 x 순서로 맞추며 Pose−Face 수직 차이를 픽셀로 표시한다. 평균 차이는 정답 오차가 아니다.
사용자가 명시한 안경 착용 상태별10초 관찰은 요청/유효/짝지음·평균 차이·추론/왕복 시간을 현재 탭에만 보관한다.
영상·Face 좌표는 진단 export·정상 수집·세션 영구 기록에 넣지 않는다.

현재 Pose 원본39D·추출기 ID·정상 등록·알림·LSTM은 유지한다. Face z는 Pose world 좌표가 아니므로
기존 모델 입력을 눈/코 점만 교체하여 섞지 않는다. 얼굴 전용 시계열 학습에는 별도 특징/수집/모델 버전과 평가가 필요하다.
사용자 화면은 Face Worker를 생성하지 않는다. 서비스 승격 전에 동일 조건의 검출 유지·기준점 오차·p95 지연을 평가한다.
