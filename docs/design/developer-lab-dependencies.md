# 개발자 실험실 의존성 기록

2026-10-13 카메라 중심 `/dev` 개편 기준. 이번 개편에서 **새 패키지 설치는 없다**.
실제 버전 고정은 `frontend/package-lock.json`, 기존 모델 자산의 파일·hash는
`frontend/model-asset.json`이 기준이다.

| 사용 항목 | 선언 버전/기술 | 용도와 경계 |
| --- | --- | --- |
| `@mediapipe/tasks-vision` | 기존 `1.0.1` | 공통 Pose 추적기에서 얼굴·어깨 13점 관측을 소비 |
| `react`, `react-dom` | 기존 `^18.3.1` | UI·수명 관리 |
| `@phosphor-icons/react` | 기존 `^2.1.10` | 제어 버튼 아이콘 |
| `pretendard` | 기존 `^1.3.9` | 한국어 UI 글꼴 |
| SVG, CSS animation/transition | 브라우저 내장 | 구도선·기준 윤곽·현재점·상태 전환·등록 진행 |
| `prefers-reduced-motion` | 브라우저 내장 | 사용자 모션 저감 설정 반영 |
| Web Audio (`AudioContext`, oscillator, gain) | 브라우저 내장 | `/dev` 지속 이탈 알림의 짧은 소리·음소거·사용자 소리 테스트 |

Pose가 이미 제공하는 얼굴 11점과 어깨 2점으로 현재 구도 안내를 구현한다.
Face Landmarker의 얼굴 메시·표정 추정은 사용하지 않는다. 별도 모델 다운로드와 중복 추론을
늘릴 필요가 있는지 실기기 측정 전에는 확정하지 않는다. 애니메이션 전용 라이브러리도 도입하지 않았다.

지속 이탈 알림에도 추가 패키지나 외부 음원 파일을 사용하지 않는다. `alertAudio.ts`가 사용자 시작·
소리 켜기·테스트 클릭 안에서 AudioContext를 준비하고, 준비된 실행 상태에서만 짧은 소리를 만든다.
차단된 컨텍스트의 자동 재개나 OS 알림 권한 요청은 없다. 중단·음소거 때 예약된 소리를 취소하고
해제 시 컨텍스트를 닫는다. 소리 재생 성공과 무관하게 시각 알림·수치 기록은 유지한다.

추가 의존성이 필요해지면 목적, 정확한 lockfile 버전, 자산 출처·용량, CPU/GPU 비용,
개발 전용 import 위치, 서비스 승격 여부를 이 문서에 기록한다. 실제 자세 예측용 LSTM JSON은
패키지와 별도이며 Git에 추가하지 않고 설정에서 연결한다.

Mac 실제 LSTM 재학습은 기존 Python 3.12.14·PyTorch 2.7.1·NumPy 1.26.4 환경을 사용했으며
추가 설치가 없었다. 학습 전용 고정은 `model/analysis/requirements-lstm.txt`에 있다.
브라우저 가중치 391,009bytes는 로컬 Git 제외 자산이고 공개 좌표 자료는 개발 서버로 제공하지 않는다.
[실제 재현·결과](../ml/jisung/2026-10-13-mac-dev-lstm-training.md).
