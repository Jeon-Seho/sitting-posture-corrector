# 로컬 예측 실험 출력 v1

`model/prototype/forecast.ts`가 만들고 별도 `#forecast`와 `/dev` 화면이 소비하는 연구용 출력이다.
기존 서비스 상태·서버·CEP·수집 라벨 계약을 대체하지 않는다.

| 필드 | 의미 |
| --- | --- |
| schema_version | `forecast-experiment-v1` |
| timeMs | 현재 단조 증가 관측 시각(ms) |
| state / ruleState | 예측 조합 / 거리·시간 대조군 상태 |
| deviation | 기준 대표 좌표와의 그룹 평균 거리; 없으면 null |
| error | 0.3초 전에 만든 예측과 현재 관측의 거리; 미준비/미대응이면 null |
| errorLimit | 해당 예측기의 기준 등록 오차 q99, 하한0.02; 기준 미등록이면 null |
| durationMs | 유효한 현재 연속 이탈 시간 |
| progress | 기준 등록 진행0–1 |
| returnedExcursions | 지속 후보 판정 전에 기준으로 복귀한 짧은 구간 수 |
| modelId | 실제 LSTM id 또는 명시적으로 선택한 위치 유지/등속 비교 방법 |
| domainValidated | 항상 false; 현재 입력·모델 호환 성능 미검증 |

상태: `needs_reference`, `registering`, `warming`, `near_reference`, `deviation_pending`,
`unexpected_motion_candidate`, `persistent_deviation_candidate`, `recovery_pending`, `unmeasurable`.
예측 오차가 높다고 일시적이라고 확정하지 않는다. 복귀·지속 관찰이 필요하다.
측정 불가일 때 거리·오차는 null, 연속 누적은0이다.

MediaPipe Pose Heavy 원래0–12의 image/world 입력이 필요하다.
13점 모두 image 화면 내부·visibility≥0.5·유한 world 좌표를 요구한다. 필수 점 부족은 측정 불가다.
world 어깨 중심·현재3D어깨폭으로 정규화하며 Panoptic 순서에 근사 재배열한다.
MediaPipe 눈/입 위치와 Panoptic 점 정의, world/camera 축은 동일함이 검증되지 않았다.

실험 설정:8초/65표본 이상 기준,30개 약10Hz 입력,300ms horizon,관측 대응±50ms,
샘플 간격95–170ms,원관측 누락250ms 이상이면 연속성 초기화.
현재 입력 자체가500ms 끊기면 UI를 측정 불가로 바꾸고 예측 큐·시간 누적을 초기화한다.
거리 시작0.12/복귀0.08,이탈3초+낮은오차1초,최대대기5초,회복3초는 연구 설정이다.

브라우저 가중치 `forecast-weights-v1`는 39입력·48hidden·30steps·horizon3의 실제 state_dict,
학습 mean/scale,source hash를 제공한다. 잘못된 버전·shape·NaN·scale≤0은 거부한다.
가중치·실제 자료는 Git에 추가하지 않는다.

`/dev`의 마지막 위치 유지·등속 비교 방법은 가중치 없이 같은 등록·품질·시간 정책을 실행한다.
LSTM은 실제 가중치가 필요하며 누락 시 합성 가중치로 대체하지 않는다. 출력 구조와 `modelId` 의미는 유지한다.

수동 export `forecast-experiment-export-v1`는 모델 provenance·설정·최대3000개 진단 출력만 포함한다.
영상·원본 관절·기준 좌표·참여자 식별자는 포함하지 않는다. 자동 저장/전송은 없다.
