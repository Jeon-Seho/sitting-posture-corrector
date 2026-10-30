# 웹캠 LSTM·룰 비교 화면

- 환경: desktop, 2026-10-13
- 브랜치: `feature/repo-baseline-mediapipe`, 기준 커밋: `8ab1c18`
- 커밋·인계 브랜치: `feature/repo-jisung-local-forecast` (같은 기준에서 분리)
- 상태: 로컬 연구 화면 구현·합성 검증 완료. 실제 웹캠 성능·자세 구분 정확도 미검증.

## 현재 학습의 이득

현재 Panoptic 단일 시퀀스 학습 결과는 LSTM 거리 오차 0.04551, 마지막 좌표 유지 0.04481이다.
학습 자료 자체에서도 단순 대조군보다 개선되지 않았다. 참여자 분리 시험 결과가 아니므로 일반화 성능으로 쓰지 않는다.
학습이 불필요하다는 결론이 아니라, 지금 모델의 추가 이득을 확인하지 못했다는 결과다.

## 직접 테스트

`frontend`에서 `npm run dev` 후 `http://127.0.0.1:5173/#forecast`를 연다.
카메라를 켜고 **실험 기준 등록**을 눌러 8초 동안 기준 자세를 유지한다.
잠깐 움직였다 복귀하기, 천천히 기울어 유지하기, 갑자기 움직인 뒤 유지하기를 각각 비교한다.
모델+룰과 룰만 사용하는 결과를 나란히 표시하며 LSTM·마지막 좌표 유지·등속 예측을 선택할 수 있다.
예측 방법 변경·카메라 종료 시 실험 기준을 다시 등록한다.
기존 서비스 기준 등록·알림·수집 라벨과 별개이며 자동 서버 전송은 없다.

입력은 MediaPipe Heavy 얼굴·어깨 13점의 world 좌표를 현재 어깨 중심·3D 너비로 정규화한다.
Panoptic 입력 순서로 근사 대응하지만 눈·입 위치 정의와 좌표계 축 분포가 동일하다는 검증은 없다.
따라서 공개 데이터 모델을 현재 카메라에 적용한 연구 실험이다. 표시 거리는 확률이나 정확도가 아니다.
13점의 가시성·화면 경계·좌표 품질이 부족하면 `unmeasurable`로 처리하고 연속 판정 시간을 초기화한다.

8초 등록에서 좌표 중앙값과 예측 잔차 99분위수(최소 0.02)를 구한다.
이탈 거리 0.12, 복귀 거리 0.08, 3초 이탈+1초 낮은 잔차 또는 5초 지속 보완 규칙, 3초 복귀는 실험 설정이다.
높은 잔차만으로 일시적 움직임을 확정하지 않는다. 실제 복귀를 확인한 경우에만 복귀 횟수를 기록한다.
수동 결과 다운로드에는 최대 3,000개 수치 진단과 모델 hash·설정만 포함하며 원본 좌표·영상은 포함하지 않는다.

## 모델 준비와 경계

실제 학습 가중치를 브라우저 JSON으로 내보낸다. 모델이 없는 다른 체크아웃에서는 모델 파일을 별도로 준비해야 한다.

```powershell
.venv/Scripts/python.exe -m model.analysis.export_forecast_browser --model runs/panoptic/2026-10-13-desktop-lstm-v1/research-lstm.pt
```

`frontend/public/research-model/forecast.json`과 원본 가중치·데이터·검증 결과 파일은 Git 제외다.
브라우저는 실제 LSTM 게이트·스케일러·잔차 보정을 실행한다. 구현은 `model/prototype/forecast.ts`에 둔다.
내부 출력은 [실험 계약](../../../contracts/forecast-experiment.v1.md), 결정은 [ADR 0025](../../decisions/0025-local-forecast-experiment.md)를 따른다.

## 실행한 검증

- `npm run check`: 45개 파일·321개 테스트 통과(이번 추가 7개), TypeScript·Vite 빌드 통과. 큰 번들 경고 있음.
- `node --experimental-transform-types frontend/scripts/forecast-parity.mjs`: 실제 가중치와 명시적 합성 입력에서 Python↔브라우저 최대 절대 차이 `2.178222965887322e-7`, 허용치 `1e-5` 통과.
- `node tools/browser/forecast-smoke.mjs`: 합성 브라우저 확인 10개 통과. 등록·LSTM 실행·이탈/복귀·가림·다운로드·데스크톱/모바일 배치·서버 API 요청 없음 확인.
- `python -X utf8 tools/dev.py check`: 저장소 검사 통과 후 Python 163개 중 159개 통과·3개 오류·1개 건너뜀으로 중단. 기존 Windows 열린 백업 파일 삭제 2건과 POSIX 배포 잠금 1건 오류. 뒤의 전체 컴포넌트 게이트는 실행되지 않았으므로 전체 성공이 아니다.

실제 카메라 품질·추론 FPS·사용자 동작 결과, 서버 i7-8700/GTX1050 성능은 이번 자동 검증 범위가 아니다.
