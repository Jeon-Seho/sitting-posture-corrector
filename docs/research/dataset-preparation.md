# 참여자 분할과 시간창 준비

- 분야: 머신러닝
- 작업: GP-0077

`model/analysis/prepare_dataset.py`는 [수집 v2](guided-collection-v2.md)를 읽어 참여자 분할 manifest,
관측 시간창, 별도 개인 기준 자료를 만든다. Python 표준 라이브러리만 사용하며 스케일러·특징 선택·
임계값을 맞추거나 모델을 학습하지 않는다. 기존 `inspect_pilot.py`와 `report_pilot.py`의 수집 진단을
대체하지 않는다. [연구 프로토콜](protocol.md)의 참여자 분할·시험 참여자 보호를 준비 단계에서 검사한다.

## 합성 실행과 설정

저장소 예제의 참여자·관측·라벨은 모두 명시적인 합성 자료다. 실제 좌표·영상·참여자 자료를 추가하지 않았다.
다음 실행은 학습/검증/시험 각각 2개 창과 개인 기준 자료 3개를 생성한다.

```sh
.venv/bin/python model/analysis/prepare_dataset.py \
  --config model/analysis/dataset/synthetic/config.json \
  --output .cache/dataset-synthetic-run-01
```

출력은 **새 디렉터리**여야 한다. 이전 실행을 덮어쓰지 않는다. Windows에서는 가상환경의
`Scripts/python.exe`로 같은 명령을 실행한다. `python -m model.analysis.prepare_dataset`도 지원한다.

설정의 `schema_version`은 `posture-dataset-config-v1`이다. 모든 연구 선택은 입력해야 하며
누락된 값에 연구상 기본값을 채우지 않는다.

| 필드 | 입력과 검사 |
| --- | --- |
| `data_kind`, `dataset_version` | `synthetic`/`private` 구분과 데이터 버전 |
| `participants` | 안정된 익명 ID, 해당 사람의 CSV `source_codes` 목록, `evaluation_only` 여부. 중복 ID·코드 소유를 거부 |
| `captures` | 설정 파일 기준 상대/절대 경로, 예상 SHA-256, 촬영 ID·참여자 소유자, `calibration`/`posture` 역할, 사용한 기준 ID 목록 |
| `split` | 아래의 분할 방법·fold·seed. 행을 읽거나 창을 만들기 전에 검사 |
| `fit_roles` | 변환기·모델 fitting에 허용할 `train` 또는 `validation` 역할. `test`는 거부. 실제 fitting은 실행하지 않음 |
| `feature_columns` | 명시적인 수치 자세 특징. 현재 head/offset/tilt·baseline·delta·visibility 열만 지원. 규칙 점수·예측·과제 지시를 특징으로 받지 않음 |
| `label_mapping` | 검토된 v2 `manual_label`을 출력 클래스로 명시적으로 연결. 요청 과제나 규칙 예측에서 정답을 만들지 않음 |
| `pose_models`, `feature_versions` | 입력에서 허용할 버전 목록. 창은 서로 다른 버전을 합치지 않음 |
| `window` | `duration_ms`, `stride_ms`, `max_gap_ms`, `min_samples`(2 이상), `discontinuity_policy`(`reject`/`break`) |

합성 예제의 500ms 창·500ms stride·400ms 최대 관측 간격·3개 최소 관측은 **코드 검증용 설정**이다.
학습 시퀀스 길이, 실제 품질·신뢰도 임계값, 카메라 시점이나 FPS의 연구 확정값이 아니다.
`measurement_quality=good`이라는 기존 CSV 상태를 사용하며 새 visibility 임계값을 추측하지 않는다.

## 분할과 fit 역할

`explicit`은 세 역할에 참여자를 직접 배정한다. 모든 참여자가 정확히 한 역할에 있어야 한다.

```json
{
  "method": "explicit",
  "fold": "research-fold-0",
  "seed": 7,
  "assignments": {
    "train": ["anonymous-A"],
    "validation": ["anonymous-B"],
    "test": ["anonymous-C"]
  }
}
```

`loso`는 `fold`에 시험 참여자 ID 한 명, `validation_participants`에 검증 참여자를 명시한다.
나머지는 학습이다. `group_kfold`는 정렬한 참여자 ID를 seed로 섞고, `fold_count`개의 그룹에
순환 배정한다. `fold`와 `validation_fold`를 서로 다른 정수 인덱스로 지정하고 나머지 그룹을 학습에 쓴다.
이 구현은 참여자 수를 고르게 나누는 그룹 분할이며, scikit-learn의 행 수 가중 배정이나 계층화를 복제하지 않는다.
최소 3개 그룹과 충분한 참여자가 필요하다. 출력은 선택한 fold 하나이며 반복 평가 시 각 fold를 별도 실행한다.
LOSO/직접 배정에서는 seed를 재현 메타데이터로 기록하고 무작위 배정을 수행하지 않는다.

시험 참여자는 `fit_participants`에서 제외한다. `evaluation_only=true`인 별도 시험 참여자를
학습이나 검증 역할에 놓으면 거부한다. 개인 보정용 촬영은 해당 사람에게만 사용할 자료로 분리하며,
학습 참여자의 기준 촬영도 이 도구의 전역 fit/평가 창에 들어가지 않는다.
메타데이터만으로 같은 사람에게 서로 다른 익명 ID를 붙였는지 알 수는 없다. 연구자는 registry의
실제 사람↔익명 ID 대응과 동의·접근 권한을 외부에서 관리해야 한다.

## 소스 검증과 창의 시간 의미

CSV는 원래 순서로 읽는다. v1이나 v1/v2 혼합, 동일 파일·해시·촬영 ID의 중복, 소유자 불일치,
다른 사람의 기준 ID, 선언하지 않은 추출기/특징 버전, 누락 열·셀, 비유한 시간/선택 특징을 거부한다.
샘플 인덱스와 `elapsed_ms` 역전·중복은 항상 거부한다. 첫 인덱스는 0이고 첫 `gap_ms`는 빈 값이어야 한다.
나머지 `gap_ms`는 실제 관측 시각 차이와 같아야 한다. 직렬화 수치 비교에만 작은 부동소수점 오차를 허용한다.
빠진 인덱스, 설정보다 긴 관측 공백, `video_time_ms` 초기화는 `reject`로 거부하거나 `break`로 새 구간을 만든다.
입력·설정 해시를 실행 전후에 다시 확인하며, 실행 중 바뀐 자료는 결과로 게시하지 않는다.

`pending`, `excluded`, 낮은 품질, `transition`, `unlabeled`, 앉은 상태가 아닌 자료,
학습 부적격·미검토 라벨·중단 촬영·매핑하지 않은 자세는 제외한다. 제외 행에서 현재 구간을 먼저 닫는다.
제외한 행의 양쪽이 다시 연결되지 않으며, 촬영·구간·기준·스키마·모델·특징 버전·원래 자세 라벨·과제 경계도 넘지 않는다.
두 원래 라벨을 같은 출력 클래스로 매핑해도 원래 라벨 경계는 유지한다.

각 창은 실제 첫 관측부터 목표 `duration_ms` 이후의 **첫 실제 관측까지** 포함한다.
예를 들어 관측이 `0, 140, 350, 520ms`이고 목표가 500ms라면 출력 끝은 520ms다.
관측 사이 최대 간격은 설정을 따르지만 정확히 500ms의 고정 길이 텐서라는 뜻은 아니다.
다음 창은 이전 시작 시각에 `stride_ms`를 더한 시각 이후의 첫 관측에서 시작한다.
최소 관측 수를 채우지 못하거나 목표 시간에 도달하지 못한 꼬리 구간은 창을 만들지 않는다.
원래 시각과 관측 수를 보존하며 10Hz 가정, 보간, 프레임 복제, padding을 수행하지 않는다.
가변 관측 수를 모델 입력으로 변환하는 방식과 마스크/패딩 정책은 후속 연구 결정이다.

## 개인 기준과 출력 보관

각 자세 촬영은 같은 소유자의 별도 `calibration` 촬영을 참조해야 한다. 기준 촬영은
`upright`·`neutral`·`reference` 과제이며, accepted/good/seated/eligible/completed 관측만 별도 연속 구간으로 남긴다.
유효한 기준 관측이 없거나 이탈 자료를 기준 역할로 선언하면 거부한다.
동일 참여자·기준 ID·추출기·특징 버전의 `baseline_*` 값이 바뀌면 미표시 기준 재등록으로 거부한다.
이 검사는 CSV 값의 일관성을 확인한다. 해당 기준 값이 실제로 별도 촬영에서 계산됐는지 증명하지는 않으며,
`derived_baseline_verified=false`를 기록한다. 이 도구는 개인 기준 평균이나 변환기를 계산하지 않는다.

| 출력 | 내용 |
| --- | --- |
| `manifest.json` | 설정/소스 해시·코드 revision과 준비 모듈 해시·Python 버전, 참여자 분할·fit 허용 대상, 소유/촬영 역할, 창 수·제외/불연속 진단 |
| `windows.jsonl` | 창 ID, 분할/소유/촬영/기준/버전/원래·매핑 라벨, 실제 시각과 선택한 수치 특징 |
| `calibrations.json` | 개인 보정 전용의 검토된 실제 관측 구간. `global_fit_allowed=false`, `evaluation_windows_allowed=false` |

원본 좌표 JSON·영상·규칙 점수/예측을 이 출력에 자동으로 복사하지 않는다. 출력에도 익명 참여자 ID·경로·해시·
움직임 특징이 있으므로 실제 데이터 설정·manifest는 접근 통제된 외부 위치 또는 Git 제외 경로에 보관한다.
저장소 안의 비제외 출력 경로는 합성 실행에도 거부한다. 임시 디렉터리에서 검증한 뒤 출력 디렉터리를
원자적으로 새로 확보한다. 동시에 생긴 빈 디렉터리도 덮어쓰지 않으며, 파일은 배타적 생성으로 게시한다.
`manifest.json`을 마지막에 쓰고 `preparation_status=complete`를 기록한다. 읽는 쪽은 전체 manifest의
파싱과 완료 상태를 확인한 뒤 다른 파일을 사용해야 한다. 게시 실패 시 자신이 생성한 파일만 정리한다.
POSIX에서는 디렉터리 0700·파일 0600을 사용한다. Windows ACL 설정·접근 통제는 별도로 관리해야 한다.
이 작업은 실제 자료 수집·학습·에피소드 평가·정확도 검증을 실행한 결과가 아니다.

검증은 `tests/test_dataset_preparation.py`의 합성 성공/누수/시간·기준 오염 사례와 실제 CLI 실행이며,
루트 `make check`의 Python unittest discovery에 포함된다.
