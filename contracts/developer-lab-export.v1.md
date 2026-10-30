# 개발자 실험 진단 내보내기 v1

`/dev`의 수동 다운로드 전용 연구 자료다. 기존 `forecast-experiment-export-v1`와 별도로 버전 관리하며
서비스 상태·API·학습 정답 계약을 대체하지 않는다. 생성기는 `frontend/src/features/developer/session.ts`다.

스키마 식별자는 `developer-lab-export-v1`. 한 실행의 시작 시각, 입력 출처(`camera` 또는 `synthetic`),
예측 방법(`hold_last`, `constant_velocity`, `lstm`), 실제 모델 ID/hash(단순 예측의 hash는 null),
연구 설정, 요약, 최대 3,000개의 [수치 진단](forecast-experiment.v1.md), 최대 100개 상태 전이 기록을 포함한다.
합성 자료는 실제 사용자의 측정이나 모델 검증 결과가 아니다. `domain_validated`는 항상 false다.

요약은 실행 경과 ms, 등록 후 유효 관측 ms, 기준 근처 ms, 측정 불가 ms, 기준 근처 비율(0–100 또는 null),
평균 예측 오차(null 허용), 지속 이탈 후보 수다. 품질·준비·시간 공백을 유효 시간에서 제외한다.
비율과 거리·오차는 정확도 또는 의료적 평가가 아니다. 이탈 후보 수는 서비스 알림 횟수가 아니다.

설정은 기준 8초·65개 유효 표본, 등록 표본 간 최대 1000ms, 300ms 예측, 이탈 거리0.12/복귀0.08, 연속 이탈3초+낮은 오차1초 또는
최대대기5초, 회복3초다. 개인 기준의 정상성은 등록 가정이며 검증 정답이 아니다.
실제 모델 사용 시 Panoptic→MediaPipe 대응은 근사이며 검증되지 않았다.

2026-10-13 카메라 안내 개편부터 선택적 `guidance_settings`에 실제 사용한 안내 시간·구도·안정
유지 설정을 추가한다. 최신 파일에는 등록 중 짧은 관측 누락 유예(`reference_grace_ms`)도 포함한다. 오래된 v1 파일에는 없을 수 있다. 값은 연구용 촬영 준비 조건이며
판정 기준이나 정확도가 아니다. 실행 경과 시간은 카메라 준비·안내·정렬·기준 등록을 포함한다.
가이드의 현재점·기준 윤곽과 화면 변환 좌표는 내보내지 않는다.

## 개발자 알림의 선택적 필드

2026-10-13 지속 이탈 알림 추가부터 다음 필드를 덧붙인다. 기존 v1 파일에는 없을 수 있으며,
필드가 없다는 것을 알림 0회로 해석하지 않는다. 메모리의 `LabRecord`에서는 각각 `alerts`,
`alertCount`, `alertSettings`가 선택적 필드다.

| JSON 필드 | 의미 |
| --- | --- |
| `alerts` | 최근 알림 최대 100개의 스냅샷. `timeMs` 오름차순이며 과거 값은 이후 관측으로 수정하지 않음 |
| `alert_count` | 해당 실행에서 생성한 전체 알림 수. 최초 알림과 60초 재알림을 포함하며 `alerts.length`보다 클 수 있음 |
| `alert_settings` | 실행에 고정한 `{basis, reminder_ms}`. `basis`는 `predictor` 또는 `rule`, `reminder_ms`는 60000 |
| `alert_limit` | 알림 스냅샷 보관 상한 100 |

`alerts`의 각 원소는 아래 필드만 명시적으로 복사한다. 상위 실행의 `source`와 별개로 각 알림에도
출처를 남겨 합성 데모를 실제 사용자 알림으로 읽지 않도록 한다.

| 알림 필드 | 자료형·단위와 의미 |
| --- | --- |
| `id` | 실행 안에서 증가하는 알림 번호. 보관 상한 때문에 첫 보관 번호가 1보다 클 수 있음 |
| `timeMs` | 실행 시작 기준 ms |
| `basis` | `predictor`: 선택한 예측+거리·시간 상태, `rule`: 거리·시간만의 상태 |
| `kind` | 최초 `first` 또는 같은 사건의 재알림 `reminder` |
| `deviation` | 알림 시점의 정규화 3D 그룹 평균 거리. 0.12는 UI의 12% |
| `peakDeviation` | 해당 알림 시점까지 같은 사건에서 관측한 최대 거리 |
| `durationMs` | 알림 시점에 코어가 출력한 연속 이탈 지속 ms |
| `error` | 300ms 예측 오차 또는 null |
| `errorLimit` | 기준 등록으로 정한 예측 오차 한계 또는 null |
| `source` | `camera` 또는 `synthetic` |

과거 기본 알림 기준은 `predictor`였다. 2026-10-14부터 `/dev` 새 실행의 기본은 `rule`이다. 알림부는 코어의 지속 이탈 후보를 소비하며 별도의 자세 분류를
만들지 않는다. 복귀 확인 중 반등은 같은 사건이고 기준 범위 복귀 또는 관측 단절에서 사건을 종료한다.
관측 단절은 정상 복귀를 의미하지 않는다. 음소거와 오디오 차단에도 시각 알림과 기록은 생성되므로
`alert_count`는 실제 소리 재생 횟수가 아니다. 요약의 `deviations`는 예측+룰 후보 사건 수이고,
`alert_count`는 선택한 알림 기준의 재알림까지 포함하므로 서로 일치할 필요가 없다.

영상·음성·원본 관절·개인 기준 좌표·모델 가중치·참여자 식별자를 포함하지 않는다.
다운로드 전 자료는 탭 메모리에만 있으며 자동 저장·업로드나 외부 파일 import 기능은 제공하지 않는다.
모델 파일 import는 이 진단 파일과 별도다.


## 관측 모드와 개인 정상 범위 (2026-10-14)

새 실행의 `readings`에는 선택 필드 `evaluationMode: observed-v2`, `predictionTimeMs`,
`normalScore`, `normalProfileId`를 추가한다. ADR 0030 적용 실행에는 `predictionInputMaxGapMs: 500`도
선택적으로 포함한다. 상위 `normal_profile_id`는 적용 개인 범위 ID 또는 null이다.
알림 스냅샷에도 `normalScore`, `normalProfileId`가 있을 수 있다. 값과 의미는
[예측 실험 확장](forecast-experiment.v1.md)을 따른다. 개인 범위 파라미터·원본 좌표·참여자 코드는
이 진단 내보내기에 포함하지 않는다. 별도의 정상 자료 내보내기만 원본 수집 계약을 따른다.

관측 모드의 유효 시간·유지 비율·사건 수는 실행에 고정한 `alert_settings.basis`의 상태를 사용한다.
관측 기반 `rule`은 예측 준비와 독립적으로 유효하며 250ms 초과 시간 공백·실제 측정 불가는 제외한다.
개인 정상 범위가 적용되면 `normalScore` 1배/2⁄3배가 진입/복귀 조건이고 `deviation`은 참고 거리다.
내보낸 `settings`의 기본 거리·예측 비교 조건과 별개로 `observation_settings`에 적용 모드·간격·정상 범위
경계·집계 기준을 명시한다. 기존 필드가 없는 과거 파일은 이 의미로 재해석하지 않는다.

`observation_settings.maximum_gap_ms`는 계속 250, `predictor_grid_ms`는 100이다.
새 출력에 `predictionInputMaxGapMs`가 있을 때만 `observation_settings.predictor_max_gap_ms`를 덧붙인다.
현재 값 500은 예측 입력이 이미 도착한 두 유효 관측 사이의 짧은 처리 지연을 연결하는 상한이며,
규칙·알림·자동 라벨의 관측 유효 시간에는 적용하지 않는다. 250ms 초과 구간은 계속 측정 불가로 제외한다.
품질 실패·탭 숨김·시각 역전·500ms 초과에는 예측 창도 비운다. 지연을 메운 격자를 잔차 평가 정답으로 쓰지 않는다.

카메라의 `timeMs`는 실제 추론 시작 시각에서 실행 시작을 뺀 값이다. 첫 결과 수신 지연을 전체 시각에
더하지 않는다. 새 선택 필드가 없는 과거 실행의 간격 정책이나 시각을 소급 수정하지 않는다.
화면의 준비 개수·마지막 초기화 이유·간격·보간 횟수 등 `predictionStatus`와 미래 좌표는 메모리 표시 전용이며,
이 진단 파일에는 포함하지 않는다. [ADR 0030](../docs/decisions/0030-predictor-cadence-recovery.md).

2026-10-15 숫자 진단부터 `ruleDurationMs`, `ruleReturnedExcursions`, `ruleRecoveryMs`,
`predictionRecoveryMs`를 선택적으로 내보낸다. 룰과 예측 조합의 시간·복귀 횟수를 섞지 않기 위한 수치이며
필드가 없는 과거 파일은 알 수 없음으로 유지한다. 자세 의도·정답 라벨은 아니다.
화면 위치·어깨폭 변화 진단은 계속 메모리 표시 전용이다. [선택 필드 의미](forecast-experiment.v1.md).

## 등록 검증·추출기 재현 메타데이터 (2026-10-14)

선택 필드 `pose_model_id`, `forecast_schema`, `camera_metadata`를 추가한다. camera_metadata는 첫 실제 관측의
pose_model_id, delegate(CPU/GPU), width, height와 실행 pacing(미상이면 null)만 담는다. 과거 실행은 미상으로 유지한다.
`reference_validation`은 등록 후보의 status, reason, score, profile_id 또는 null이다. accepted는 사용자 확인 정상 분포와의
일치이며 의학적 정상 인증이 아니다. 원본 후보나 특징별 좌표는 내보내지 않는다. baseline_normality의 기존 등록 가정 의미는 유지한다.
`approximate_point_mapping`은 카메라+LSTM+v1일 때 true, MediaPipe v2일 때 false다. 이 false는 자세 정확도 검증을 뜻하지 않는다.
개인 정상 범위의 새로운 진입 비교는 >1(경계 1 포함 정상)이며 [예측 계약](forecast-experiment.v1.md)을 따른다.

## 고정 영상 보완 진단 (2026-10-15)

선택 `readings[].postureScore`, `readings[].imagePosture`는 [예측 계약](forecast-experiment.v1.md)의 종합 점수와
스칼라 영상 진단이다. 현재 관측의 상대 모양 변화와 몸 전체 변화 중 큰 점수가 판정에 쓰인다.
기존 `deviation`과 `normalScore`의 상대 좌표 의미는 그대로이며 0일 때도 몸 전체 이탈로 알림이 생길 수 있다.
선택 `alerts[].postureScore`, `imagePosture`, `peakPostureScore`는 해당 알림 시점과 사건의 관측된 최고 종합 점수다.
알림 스냅샷은 이후 관측으로 바뀌지 않는다. 원본 영상 기준·등록 위치·참여자·프로파일 원본을 내보내지 않는다.
이 필드가 없는 과거 실행을 새 보완 경로로 재해석하지 않는다.

## 종합 경계 출처 확장 (2026-10-15)

새 실행의 reading·alert에는 선택 숫자 `postureEntryRatio:0.7`, `postureRecoveryRatio:0.7*2/3`를 보존한다. `observation_settings`의 `composite_entry_ratio`·`composite_recovery_ratio`는 적용한 종합 경계다. `normal_entry_ratio:1`은 종전 정상 범위의 기준 단위이며 새 종합 판정의 진입 경계로 쓰지 않는다. 필드가 없는 이전 기록은 1·2/3을 유지한다. 영상·원본 좌표를 추가하지 않는다. [ADR 0036](../docs/decisions/0036-composite-entry-point-seven.md).
## 얼굴 전용 비교의 제외 경계 (2026-10-15)

Face Worker의 영상 bitmap·478점/표시 윤곽·Face/Pose 차이 비교 표는 현재 탭의 개발 비교 전용이다.
이 진단 export나 정상 수집 v1/v2의 Pose 원본에 포함하지 않는다. Face 도입이 기존 모델의 추출기 ID를 바꾸거나 정상/이탈 라벨을 새로 만드는 것은 아니다.
현재 Face와 Pose를 혼합한 학습 입력 계약은 없다. [결정](../docs/decisions/0037-developer-face-landmarker.md)을 따른다.
