# CSV 파일럿 수집과 pandas 탐색

이 문서의 수집 UI·규격은 **기존 v1** 기록을 설명한다. 현재 Heavy 수집 UI와 좌표·검토 필드는
[안내형 수집 v2](guided-collection-v2.md)를 따른다. 기존 파일은 보존하며 분석 도구는 두 버전을 읽는다.

현재는 파일럿이므로 Docker/DB보다 CSV로 특징과 라벨을 먼저 확인한다.
여러 사용자의 업로드·접근 권한·기록 검색이 필요해질 때 서버/DB를 도입한다.
이 기능은 모델 학습 완료나 연구용 수집 프로토콜 확정을 의미하지 않는다.

## 수집 순서

1. 웹캠을 켜고 5초 기준 등록 후 측정을 시작한다.
2. 화면 아래 `파일럿 데이터 수집`에 참여자 코드(P01, P02 등)를 입력한다. 실명 대신 같은 사람은 같은 코드를 사용한다.
3. 자세 라벨을 선택하고 `수집 시작`을 누른다. 우선 편안한 기준 자세를 짧게 기록한다.
4. 자세를 바꿀 때는 `자세 바꾸는 중`, 자세가 안정된 뒤 해당 라벨을 선택한다. 왼쪽/오른쪽은 사용자 본인 기준이다.
5. `수집 중지` 또는 `CSV 다운로드`로 멈춘다. 다운로드는 현재 수집도 중지한다.
6. 다음 파일은 다운로드 확인 후 `새 파일 준비`로 시작한다. 새 파일마다 다른 capture_id를 만든다.

라벨은 수집자의 자기 보고다. `rule_prediction`은 정답이 아니며 학습 라벨로 복사하면 안 된다.
처음에는 특징 분포와 누락률을 확인한다. 연구 데이터는 촬영·라벨 지침과 검토 절차를 따로 확정해야 한다.
현재는 정면 2D 특징 3개만 수집하므로 완성된 LSTM 학습 데이터셋은 아니다.
원본 좌표 없이 다른 특징을 재계산할 수 없다. 추가 특징이 필요하면 수집 스키마 버전을 올리고 재수집한다.

## 파일과 시간 규칙

- `posture-pilot-P01-<capture_id>.csv`, UTF-8 BOM, 헤더 포함. 행은 실제 새 추론 결과만 사용한다.
- 최대 10행/초로 낮춰 저장한다. 고정 10 Hz가 아니며 빠진 프레임을 복제·보간하지 않는다.
- 추적·화면 표시 속도와 CSV 수집 속도는 다르다. 화면 평활화는 CSV/판정에 적용하지 않는다.
- 품질 불충족 프레임도 `poor`로 기록하되 특징·점수는 빈 칸이다. pandas에서는 NaN이다.
- 휴식·숨겨진 탭에서는 행을 추가하지 않는다. 재개 시 segment_id가 바뀌고 elapsed_ms에는 실제 공백이 남는다.
- 라벨 변경, 품질 유실·복귀, 1초 초과 추론 간격에도 segment_id가 바뀐다. 이 경계를 가로질러 시퀀스를 만들지 않는다.
- 카메라 오류/종료/화면 이동 시 수집을 중지한다. 이전 CSV 버퍼는 현재 탭에서 다운로드할 수 있다.
- 18,000행에 도달하면 자동 중지한다. 화면 이동은 버퍼를 보존하지만 새로고침·탭 종료 시 지워진다.
- 원본 영상·랜드마크는 저장하지 않으며 서버 전송·localStorage·DB 저장도 없다. 명시적 CSV 다운로드만 파일로 남는다.
- 실제 파일은 저장소 밖 또는 Git 제외 경로 `data/`에 보관한다. 개인 움직임 특징이므로 공개 저장소에 올리지 않는다.

## 주요 열

| 열 | 의미 |
| --- | --- |
| schema_version | posture-pilot-v1 |
| participant_code / capture_id | 참여자 분할 키 / 수집 파일 고유 ID |
| started_at | 수집 시작 UTC ISO 시각 |
| sample_index / elapsed_ms / video_time_ms / gap_ms | 행 번호 / 수집 시작 이후 단조 시간 / 카메라 재생 시간 / 직전 저장 행과의 간격 |
| segment_id | 같은 라벨·연속 품질 구간 식별자 (capture_id와 함께 사용) |
| manual_label / label_source | 미지정·기준·앞으로·왼쪽·오른쪽·전환 / self_report 또는 none |
| measurement_quality / visibility | good 또는 poor / 얼굴·양 어깨의 최소 가시성, 정확도 아님 |
| head_gap / lateral_offset / shoulder_tilt | 어깨 너비로 정규화한 머리 높이·좌우 편위·어깨 기울기 (무단위) |
| baseline_* / delta_* | 5초 개인 기준 / 부호를 보존한 기준 대비 차이 |
| rule_score / rule_prediction | 0~1 규칙 점수 / normal·deviation·unmeasurable. 3초 확정 전의 프레임 판정 |
| threshold / hold_seconds / realert_seconds / recover_seconds | 수집 시작 때 고정한 판정 설정 |
| inference_ms / delegate / width / height | 해당 추론 호출 시간 / GPU·CPU / 실제 영상 크기 |
| pose_model / feature_version / calibration_seconds / target_sample_hz | 추출기·특징 버전 / 등록 시간 / 수집 목표 상한 |

## pandas로 보기

프로젝트 가상환경에서 pandas를 별도 설치한다. 서비스 실행·기본 테스트에는 필요하지 않다.
예제는 pandas 2.2.3에서 확인했다.

```sh
.venv/bin/python -m pip install pandas==2.2.3
.venv/bin/python model/analysis/inspect_pilot.py ~/Downloads/posture-pilot-*.csv
```

또는 노트북에서:

```python
import pandas as pd

df = pd.read_csv("수집한_파일.csv", encoding="utf-8-sig")
valid = df.query("measurement_quality == 'good'")
labeled = valid[~valid.manual_label.isin(["unlabeled", "transition"])]
print(df.groupby(["manual_label", "measurement_quality"]).size())
print(labeled.groupby("manual_label")[["delta_head_gap", "delta_offset", "delta_tilt"]].mean())
# 주기가 일정하지 않으므로 시간축은 행 번호가 아닌 elapsed_ms를 사용한다.
```

본 학습 전에는 참여자 단위로 분할하고, 분할 이후에 capture_id·segment_id별 시퀀스를 만든다.
동일 파일의 중복 다운로드는 capture_id+sample_index로 제거한다.
서로 다른 사람에게 같은 P01을 쓰거나 같은 사람에게 다른 코드를 쓰면 참여자 평가가 성립하지 않는다.

## 화면 점수와 분석 보고서

화면은 이제 100점이 기준에 가까운 `100 * (1 - rule_score)`를 사용한다. CSV의 기존 열 의미는 바뀌지 않았다.
시간축 공백을 연결하지 않는 그래프와 Markdown 보고서는 다음으로 생성한다. 원본 CSV는 변경하지 않는다.

```sh
.venv/bin/python -m pip install -r model/analysis/requirements.txt
.venv/bin/python model/analysis/report_pilot.py 수집한_파일.csv --output database/temp/analysis
```

`database/temp/`는 실제 파일과 개인 분석 결과를 위한 Git 제외 경로다. 파일 하나에 한 수집 ID를 사용한다.
