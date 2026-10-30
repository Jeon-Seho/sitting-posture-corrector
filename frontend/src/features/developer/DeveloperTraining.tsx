import { useState } from 'react'
import './training.css'

const TRAINING_COMMANDS = `python -m model.analysis.mediapipe_lstm manifest --mode pilot \\
  --output "$HOME/posture-private/manifest.json" "$HOME/posture-private/collection.json"

python -m model.analysis.mediapipe_lstm validate \\
  --manifest "$HOME/posture-private/manifest.json" --mode pilot

python -m model.analysis.mediapipe_lstm train \\
  --manifest "$HOME/posture-private/manifest.json" --mode pilot \\
  --output "$HOME/posture-private/run-01" --epochs 25`

/** Guidance only. Training is an explicit local command, never a browser upload. */
export default function DeveloperTraining({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [copyStatus, setCopyStatus] = useState('')
  const copyCommands = async () => {
    try { await navigator.clipboard.writeText(TRAINING_COMMANDS); setCopyStatus('명령을 복사했습니다. 파일을 준비한 뒤 저장소 루트에서 실행해 주세요.') }
    catch { setCopyStatus('명령을 선택해서 직접 복사해 주세요.') }
  }
  return <section className="lab-panel dev-training" aria-labelledby="dev-training-title">
    <div className="dt-heading"><div><span className="dt-eyebrow">수집 다음 단계</span><h2 id="dev-training-title">내 자료로 예측 모델 만들기</h2></div><span className="dt-local">이 기기에서 직접 실행</span></div>
    <p className="dt-intro">개인 정상 범위와 LSTM은 따로 준비합니다. 개인 범위는 확인한 수동 30초 자료로 바로 맞추고, LSTM은 모은 시계열로 미래 움직임을 학습합니다.</p>
    <ol className="dt-steps">
      <li><span aria-hidden="true">01</span><div><h3>정상 구간을 모아 내려받기</h3><p>자동 수집은 상대 거리 기본 6%와 종합 0.5배 이내를 1초 유지한 뒤 모읍니다. 상대 거리는 0.5%·3%·6%를 선택할 수 있고, 자동 라벨은 미검토 후보입니다. 수동 구간은 촬영 후 확인하세요.</p><small>재검토 표시가 있는 자료는 학습에서 차단합니다. 행 수와 함께 연속 학습 후보 수도 확인하세요. 끊어진 구간은 이어 붙이지 않습니다.</small></div></li>
      <li><span aria-hidden="true">02</span><div><h3>파일을 검사하고 로컬에서 학습하기</h3><p>같은 추출 모델의 JSON과 파일 목록을 준비합니다. 먼저 자료 검사를 통과한 뒤 학습을 실행하면 <code>model.json</code>과 <code>report.json</code>이 만들어집니다.</p><small>한 사람의 pilot은 학습 경로 확인용입니다. 새로운 사람에게 잘 맞는지 확인하려면 참여자를 나눈 별도 평가가 필요합니다.</small></div></li>
      <li><span aria-hidden="true">03</span><div><h3>만든 모델을 실험실에 연결하기</h3><p>설정의 학습 모델에서 <code>model.json</code>을 선택하세요. 수집에 쓴 MediaPipe 모델과 같아야 합니다. LSTM 방향과 거리·시간 판정을 나란히 비교합니다.</p><small>모델 파일 생성만으로 자세 정확도나 교정 효과가 확인되는 것은 아닙니다.</small></div></li>
    </ol>
    <details className="dt-command"><summary>로컬 학습 명령과 준비 조건</summary>
      <p>저장소 밖 <code>~/posture-private</code>에 내려받은 JSON과 <code>manifest.json</code>을 준비하세요. manifest 명령이 추출 모델 ID·참여자 코드·SHA-256을 파일에서 읽어 목록을 만듭니다. 아래 collection.json은 내려받은 파일명으로 바꾸세요. 학습 환경과 파일 목록 형식은 저장소의 <code>docs/ml/mediapipe-training.md</code>에 있습니다.</p>
      <label htmlFor="dev-training-command">한 사람 pilot 명령 · 저장소 루트에서 실행</label>
      <textarea id="dev-training-command" readOnly value={TRAINING_COMMANDS} rows={10} spellCheck={false} />
      <div className="dt-command-actions"><button type="button" className="lab-button" onClick={() => void copyCommands()}>명령 복사</button><span>출력 폴더는 새 폴더로 지정하세요.</span></div>
      {copyStatus && <p role="status">{copyStatus}</p>}
      <p>여러 참여자 평가에는 <code>--mode participant_holdout</code>을 사용하고 train·validation·test의 참여자를 겹치지 않게 배정합니다. 브라우저가 학습을 실행하거나 파일을 업로드하지 않습니다.</p>
    </details>
    <div className="dt-footer"><p>연결 경로는 합성 자료로 점검합니다. 실제 수집 자료의 자세 판정 성능은 별도 평가가 필요합니다.</p>{onOpenSettings && <button type="button" className="lab-button" onClick={onOpenSettings}>학습 모델 불러오기</button>}</div>
  </section>
}
