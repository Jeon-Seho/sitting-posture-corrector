# Heavy 안내형 좌표·라벨 수집 v2

상태: 탐색용 수집 구현. 모델 학습·정확도 검증·연구 프로토콜 동결은 별도다.
사용자는 **좌표와 라벨만 수집**하도록 선택했다. 영상·이미지·음성은 저장하지 않고 서버 업로드도 하지 않는다.
[v1 수집 규격](pilot-csv.md)의 후속 규격이며 실제 v1 파일은 변환·덮어쓰기하지 않는다.

## 사용 순서

1. 측정 준비 → 실제 웹캠 → 카메라 연결 → 5초 기준 등록 → **라벨 수집으로 이동**.
2. 참여자 코드와 실제 촬영 방향·거리·높이·작업 환경을 확인한다. 정면이 기본이며 60cm·눈높이는 수정 가능한 초기 입력값이다.
3. 과제와 길이(10/20/30/60초), 반복 회차를 선택한다. 먼저 기준 자세 과제를 촬영한 뒤 다른 과제를 촬영한다.
4. **준비 완료 · 5초 후 촬영**을 누른다. 준비 5초에는 좌표를 저장하지 않는다. 정해진 시간이 지나면 자동 종료한다.
5. 과제를 실제로 수행했는지 확인하고 구간 전체에 동일한 자세·재석 상태만 지정한다. 여러 자세가 섞였으면 미지정, 과제를 잘못 수행했으면 제외한다.
6. **라벨 확인** 또는 **제외** 후 CSV를 다운로드한다. 다음 촬영 전 확인을 거쳐 메모리 기록을 비운다. 이전 파일은 브라우저 다운로드에서 보존한다.

전용 수집 화면은 교정 알림이나 규칙 점수를 보여주지 않는다. 기존 측정 화면의 패널도 같은 수집기를 사용하지만 교정 피드백 없는 수집에는 전용 화면을 사용한다.
화면 이동·측정 일시정지/종료·카메라 끊김·탭 숨김은 촬영을 중단한다. 중단된 구간은 확정할 수 없고 제외 후 재촬영한다.
좌표 미검출은 촬영 중단 조건이 아니다. 빈 자리·얼굴 가림 과제를 계속 기록해야 하기 때문이다.

## 과제와 정답의 분리

| 과제 | 요청된 자세 | 요청된 재석 상태 | 활동 |
| --- | --- | --- | --- |
| 기준 자세 | upright | seated | reference |
| 몸통 왼쪽/오른쪽 | lean_left / lean_right | seated | posed |
| 몸통 앞으로 | trunk_forward | seated | posed |
| 머리만 앞으로 | head_forward | seated | posed (탐색용) |
| 왼쪽/오른쪽 모니터 | unlabeled | seated | monitor_left / monitor_right |
| 공책 읽기/필기 | unlabeled | seated | notebook_read / notebook_write |
| 타이핑 | unlabeled | seated | typing |
| 고개 돌리고 복귀 | unlabeled | seated | look_around |
| 일어서서 나갔다 복귀 | transition | transition | leave_return |
| 빈 자리 | unlabeled | away | empty_seat |
| 앉아서 얼굴 가림 | unlabeled | seated | occlusion |

요청된 과제·머리 방향은 **수행 지시**이며 관측된 시선 정답이 아니다. 안내 과제 중 모든 프레임이 동일한 몸통 자세라는 보장도 없다.
촬영 후 확인은 자기 보고이며 전문가 검수와 다르다. 활동을 확인했어도 자세는 미지정으로 남길 수 있다.
복귀 과제는 앉음과 부재가 섞인 구간으로 저장하며, 구간 전체를 away로 취급하지 않는다.
프레임별 상태 전환 시점의 정답이 필요하면 후속 수집/주석 도구가 필요하다. 이번에는 시간 단위 세밀한 재라벨링을 구현하지 않았다.

## 스키마와 시간

- `schema_version=posture-pilot-v2`. UTF-8 BOM CSV, 기존 파일명 `posture-pilot-P01-<capture_id>.csv` 유지.
- 한 파일은 한 촬영 과제/반복이다. 실제 관측만 최대 10Hz로 기록한다. 누락 프레임을 복제·보간하지 않는다.
- `started_at`은 준비 종료 시점의 UTC, `elapsed_ms`는 그 시점을 기준으로 한 관측 시간이다.
- 준비 이전 표본과 종료 시각 이상의 표본은 저장하지 않는다. 구간은 `[start, end)`이다.
- `video_time_ms`는 추론에 사용한 프레임의 카메라 재생 시간이며 영상 파일의 시간축이 아니다.
- `capture_id`는 촬영별 고유 ID, `calibration_id`는 완료된 기준 등록의 고유 ID다. 같은 기준으로 여러 과제를 촬영했는지 확인할 수 있다.
- 기준 등록 자체의 33개 관절 시계열은 저장하지 않는다. 추가 특징의 개인 기준이 필요하면 같은 calibration_id의 별도 기준 자세 과제에서 계산한다.
- `segment_id`는 품질 변화/1초 초과 관측 간격 등에서 분리된다. 사람·촬영·구간 경계를 넘겨 학습 창을 만들지 않는다.

v1 열의 시간·특징·규칙 점수는 같은 의미를 유지한다. v2의 head_forward는 머리만 앞으로인 과제로 좁혔고 몸통 숙임은 trunk_forward로 분리했으므로 v1 라벨을 그대로 섞지 않는다.

| 추가/변경 열 | 의미 |
| --- | --- |
| task_id / activity | 선택된 과제와 작업 상황. accepted면 수집자가 과제 수행을 확인함 |
| requested_head_direction / requested_posture / requested_presence | 촬영 안내 내용. 자동 정답으로 사용하지 않음 |
| manual_label / presence_label | 검토 후 자기 보고 자세·재석 상태. 검토 전 unlabeled / unknown |
| label_source | none / self_report_reviewed |
| review_status | pending / accepted / excluded |
| pose_training_eligible | accepted + seated + 구체적 자세 + 기존 특징 품질 good인 행만 1. 학습 적합성이 입증됐다는 뜻은 아님 |
| repetition / planned_seconds | 반복 회차와 계획 길이 |
| camera_view / camera_height / distance_cm / desk_layout | 수집자가 확인한 촬영 조건 |
| stop_reason | completed / manual_stop / tab_hidden / camera_disconnected / session_interrupted |
| calibration_id | 기준 등록 UUID |
| pose_detected / landmark_count | 추적기의 포즈 출력 유무와 좌표 수. 실제 사람이 없다는 정답으로 사용하지 않음 |
| landmarks_json | MediaPipe 영상 좌표: 최대 33개의 index,x,y,z,visibility 객체 |
| world_landmarks_json | MediaPipe 추정 world 좌표: 같은 객체 형식. 실측 모션캡처 정답이 아님 |

landmarks_json의 x/y는 영상 너비/높이 기준 정규화 좌표다. z와 world 좌표의 정의는
[공식 웹 가이드](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)를 따른다.
입력은 좌우 반전하지 않은 원본 카메라 영상이며 화면 미리보기의 거울 표시와 구분한다. 좌/우 라벨은 참여자 본인 기준이다.
좌표는 화면 보간/평활화 전 추정값이다. 낮은 가시성 좌표도 보존하되 비유한 값은 null로 쓴다.
포즈 미검출은 빈 배열이며, 기존 특징 3개/규칙 점수는 null, 예측은 unmeasurable이다.
기존 특징 품질이 poor여도 추적기에 남아 있는 좌표를 보존한다. 학습 시 목적에 맞는 품질 기준을 다시 검토해야 한다.

## pandas와 학습 준비

```python
import json
import pandas as pd

df = pd.read_csv("촬영한.csv", encoding="utf-8-sig")
confirmed = df[df.review_status.eq("accepted")]
posture_rows = confirmed[confirmed.pose_training_eligible.eq(1)]
points = df.landmarks_json.map(json.loads)
# absent는 품질 good을 요구하면 사라진다. 자세와 재석 학습 필터를 따로 만든다.
absence_rows = confirmed[confirmed.presence_label.eq("away")]
```

inspect_pilot.py, report_pilot.py는 v1/v2를 읽는다. 보고서는 제외 구간까지 진단하므로 학습 선별을 대신하지 않는다.
Lite/Heavy, 촬영 시점, 특징과 라벨 정의가 다른 자료를 무조건 합치지 않는다.
참여자별로 학습/검증/시험을 먼저 나눈다. 시험 참여자의 이탈 데이터로 튜닝하지 않는다.
소규모 안내 수집만으로 실제 작업 중 정확도나 적정 학습량을 주장할 수 없다.

## 저장과 한계

실제 파일은 database/temp 등 Git 제외 경로에서만 관리한다. 서버/DB/브라우저 영구 저장은 없다.
한 번에 최대 60초만 메모리에 모으므로 기존 18,000행 상한보다 작다. 새로고침 시 미다운로드 기록은 사라진다.
영상이 없으므로 촬영 후 실제 동작을 다시 보고 검수하거나 이미지 기반 모델을 재학습할 수는 없다.
Heavy는 관절 추정기를 바꾸며, 자세·활동 분류 모델을 새로 학습한 것이 아니다. 실제 M1 Air FPS와 관절 정확도는 별도 검증 대상이다.
