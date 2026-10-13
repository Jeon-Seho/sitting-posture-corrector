# MultiPosture 얼굴·어깨 모델 실제 학습

- 날짜·환경: 2026-10-13 · desktop · Windows 11 · Python 3.12.7
- 브랜치·기준 커밋: `feature/repo-baseline-mediapipe` · `8ab1c18` + 미커밋 작업
- 상태: 공개 자료 다운로드·오프라인 모델 학습·참여자 분리 평가 완료. 서비스 적용 성능 미검증.
- 도구: [multiposture.py](../../../model/analysis/multiposture.py), [실행·입력 설명](../../../model/analysis/MULTIPOSTURE.md)
- 배경: [외부 자료 조사](2026-10-13-desktop-external-dataset-review.md)

## 자료·학습 설정

[MultiPosture](https://zenodo.org/records/14230872), DOI 10.5281/zenodo.14230872, CC BY 4.0.
저자: David Carneros Prado, Luis Cabañero Gómez, Jesus Fontecha, Ramon Hervas,
Iván González Díaz, Esperanza Johnson. 라이선스와 출처는 원본 옆 메타데이터에 보존한다.

원본 9,327,935 bytes, MD5 `7efbc94d653acf32eefecec3ff26d6c6`,
SHA-256 `d21579200db9a57dd01c24fa6ece961b0be73aa0d5d402ae8e629761c03ebe38`.
실제 13명·4,794행이며 이번 특징 검사의 좌표 누락·비유한 값·어깨 붕괴 제외는 0행이다.
이는 원본의 visibility나 실제 검출 정확도가 모두 유효하다는 의미는 아니다.

원래 MediaPipe 0~12의 얼굴 11점·어깨 2점만 사용한다. 골반·손목·참여자 ID·하체 라벨은 입력에서 제외했다.
목표 라벨은 배포 자료의 몸통 직립(TUP)·앞(TLF)·뒤(TLB)·왼쪽(TLL)·오른쪽(TLR) 5개다.
개인 기준 이탈 정답으로 바꿔 부르지 않는다.

seed 42에서 **참여자 단위 학습 8명/2,814행, 검증 2명/750행, 시험 3명/1,230행**.
참여자 ID 목록은 Git에 올리지 않는 실행 보고서에만 저장한다.
검증 Macro-F1으로 후보를 선택했고 시험으로 특징·설정·임계값을 튜닝하지 않았다.
내보낼 때만 학습+검증 10명으로 선택된 모델을 다시 학습했고 시험 3명은 계속 제외했다.

## 같은 학습 분할에서의 특징 비교

| 특징·모델 | 검증 Macro-F1 | 시험 정확도 | 시험 Macro-F1 |
| --- | ---: | ---: | ---: |
| 코·어깨 3특징 + 로지스틱 | 0.5718 | 58.54% | 0.5798 |
| 코·어깨 3특징 + 랜덤 포레스트 | 0.5181 | 58.62% | 0.5658 |
| 얼굴·어깨 13점/36특징 + 로지스틱 | **0.8172** | **81.30%** | **0.8041** |
| 얼굴·어깨 13점/36특징 + 랜덤 포레스트 | 0.7119 | 69.67% | 0.6834 |

13점 로지스틱을 검증 단계에서 선택했다. 외부 자료에서 얼굴을 포함하는 방향은 코 중심 비교군보다
좋은 결과를 냈다. 다만 이 코·어깨 비교군은 기존 앱의 픽셀 규칙을 그대로 재현한 것이 아니다.
모두 같은 외부 xyz와 3D 어깨 너비를 사용하는 비교이며 기존 앱 정확도와 비교하지 않는다.

검증을 포함해 10명으로 다시 학습한 **실제 저장 모델**은 같은 시험 3명에서
**정확도 84.47%, Macro-F1 0.8111, balanced accuracy 82.40%**였다.
이 refit 결과를 위 8명 학습 비교군과 동일 조건의 특징 개선량으로 쓰지 않는다.

| 저장 모델의 시험 클래스 | 재현율 | 정답 행 수 |
| --- | ---: | ---: |
| 직립 TUP | 69.89% | 445 |
| 앞 TLF | 96.47% | 539 |
| 뒤 TLB | 54.55% | 66 |
| 왼쪽 TLL | 100.00% | 90 |
| 오른쪽 TLR | 91.11% | 90 |

직립 445행 중 134행을 다른 몸통 자세로 분류했다. 뒤로 기울임도 구분이 약하다.
시험 참여자가 3명뿐이고 프레임 간 상관이 있으므로 위 수치를 실제 사용자의 기대 정확도로 해석하지 않는다.
특히 직립을 정상으로 연결하면 오알림이 생길 수 있어 서비스 알림에 연결하지 않았다.

## 개인 기준 방향에 맞춘 구현

- 현재 특징은 어깨 중심 상대 위치를 3D 어깨 너비로 나누고 어깨 방향을 유지한다.
- 별도 기준 15개 이상이 명시적으로 주어지면 등록 좌표의 중앙값을 기준으로 변화량을 계산한다.
- 외부 학습+검증 참여자의 TUP 내부 변동으로 척도·축소 공분산을 학습한다.
  개인 기준과 현재 상대 형상의 변화 거리에 이를 사용하지만 정상 확률·알림 임계값은 만들지 않는다.
- 코·눈·귀·입·어깨 그룹의 거리 가중치를 균등하게 둔다. 눈 6개 때문에 거리만 과도해지는 것을 줄인다.
- 기준 상대 변화, world 좌표 변화, 어깨 중심 이동과 너비 비율을 별도 출력한다.
  외부 자료의 골반 중심 좌표로 영상 절대 좌표 변화 검증을 대체하지 않는다.
- 낮은 품질·누락은 `unmeasurable`, 기준 미등록이면 개인 변화량은 null이다.
- 연구용 결과에는 `service_label=null`, `alert=null`, `domain_validated=false`를 명시한다.

시험 참여자의 라벨을 이용해 기준 TUP 행을 뽑거나 개인 보정을 하지 않았다.
따라서 **개인 기준 이탈 거리의 시험 성능은 아직 결과가 없다**.
현재 앱 baseline JSON을 이 도구에 바로 넣는 품질·좌표계 어댑터도 아직 구현하지 않았다.
원본 xyz와 실제 Pose Heavy world 좌표의 호환성을 확인한 후 별도 수집으로 검증해야 한다.

## 산출물과 재실행

Git에서 제외된 로컬 위치:

```text
data/external/multiposture-v1/data.csv
data/external/multiposture-v1/source.json
runs/multiposture/2026-10-13-desktop-v1/research-model.joblib
runs/multiposture/2026-10-13-desktop-v1/reference-scatter.json
runs/multiposture/2026-10-13-desktop-v1/report.json
```

저장 모델 묶음(분류기+정규화+연구 거리 척도) **11,982 bytes**.
CPU에서 분류기 단일 행만 측정한 p50 **0.311 ms**, p95 **0.333 ms**.
이 환경에서의 짧은 측정이며 MediaPipe·카메라·전송·동시 요청·알림은 제외했다.
GPU/CNN은 사용하지 않았고 사용자 서버 하드웨어의 운영 성능을 검증한 것은 아니다.

```powershell
.venv/Scripts/python.exe -m model.analysis.multiposture download
.venv/Scripts/python.exe -m model.analysis.multiposture train --input data/external/multiposture-v1/data.csv --output runs/multiposture/new-run-name
```

numpy 1.26.4 / scipy 1.13.1 / scikit-learn 1.6.1 / joblib 1.4.2 / threadpoolctl 3.5.0.
기존 실험은 덮어쓰지 않는다. 원본 hash, seed, 분할, 소스 hash와 라이브러리 버전은 report에 남긴다.
이 환경은 미커밋 코드로 학습했으므로 HEAD만으로 재현된다고 쓰지 않는다.

## 검증 결과

- 신규 합성 단위/훈련 테스트 7개 통과: 분할 누수, 시험 자료 변경 시 선택/모델/척도 불변성,
  품질 누락, 이미지/world 혼용, 불완전 기준, 기하학적 불변성, 출력 경로·실제 자료 hash 확인.
- 실제 저장 모델로 명시적 합성 입력을 사용한 `predict` CLI 확인: 변화량 산출·서비스 판정/알림 null.
- Python 전체 게이트 실행(신규 테스트가 6개였던 시점): 146개 중 142개 통과, 3개 오류, 1개 skip.
  기존 배포 테스트의 Windows 열린 백업 파일 삭제 2건, POSIX deployment lock 1건이 오류다.
  이후 추가한 시험 변형 불변성 테스트를 포함한 신규 7개는 별도 재검증해 통과했다.
- `python -X utf8 tools/dev.py check-repo` 통과: 문서 링크·저장소 구조·민감 산출물 경로 검사.
  `git diff --check` 통과. 원본 CSV와 저장 모델의 Git ignore도 확인했다.
- 라이브 앱 타입·빌드·브라우저·전체 `make check`는 이번 연구 코드 변경에서 실행하지 않았다.
  신규 합성 학습 테스트는 루트 `test`/`make check`/CI 자동 탐색에 연결했다.

EYEDIAP은 접근 신청이 필요해 이번 학습에 포함하지 않았다.
