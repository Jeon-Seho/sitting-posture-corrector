import { useEffect } from 'react'
import type { ForecastState } from '../../../model/prototype/forecast'
import { CameraStage } from '../components/CameraStage'
import { VisualControls } from '../components/VisualControls'
import type { CameraController } from '../hooks/useCamera'
import { useForecastExperiment } from '../features/forecast/useForecastExperiment'

const labels: Record<ForecastState, string> = {
  needs_reference: '실험 기준을 등록해 주세요', registering: '기준 자세를 관찰하고 있어요',
  warming: '움직임 흐름을 모으고 있어요', near_reference: '기준 근처',
  deviation_pending: '기준에서 벗어남 · 지켜보는 중', unexpected_motion_candidate: '예상 밖 움직임 · 복귀 확인 중',
  persistent_deviation_candidate: '지속된 자세 이탈 후보', recovery_pending: '기준 복귀 · 유지 확인 중',
  unmeasurable: '측정 불가 · 얼굴과 양쪽 어깨를 보여 주세요',
}
const percentage = (v: number | null | undefined) => v == null ? '—' : `${(v * 100).toFixed(1)}%`
export function ForecastPage({ camera }: { camera: CameraController }) {
  const experiment = useForecastExperiment(camera)
  useEffect(() => { camera.stop(); return () => camera.stop() }, [camera.stop])
  const r = experiment.reading
  return <main className="collection-entry forecast-entry">
    <video ref={camera.videoRef} className="capture-source" muted playsInline aria-hidden="true" />
    <div className="collection-entry-nav"><strong>PoseGood · 예측 실험</strong><a className="btn" href="#collection">수집 화면으로</a></div>
    <div className="page-head"><div><h1 className="page-title">움직임 예측 실험</h1>
      <p className="page-desc">같은 움직임을 거리·시간 규칙과 예측 모델로 비교합니다. 화면의 결과를 보면서 직접 움직여 보세요.</p></div></div>
    <section className="forecast-notice" aria-label="예측 실험 안내">
      <strong>학습한 LSTM을 사용하는 연구용 화면입니다.</strong>
      <p>학습 데이터와 현재 카메라의 점 정의·좌표계가 달라 근사 연결했습니다. 실제 자세 판정 성능은 미검증이며 점수·일별 기록·교정 알림에는 반영하지 않습니다.</p>
    </section>
    <div className="row forecast-controls">
      {camera.state === 'loading' ? <button className="btn" onClick={camera.stop}>카메라 준비 취소</button> :
        camera.state === 'on' ? <button className="btn" onClick={camera.stop}>카메라 끄기</button> :
        <button className="btn btn-primary" onClick={() => void camera.connect()}>카메라 켜기</button>}
      <button className="btn" disabled={camera.state !== 'on' || !experiment.model || r?.state === 'registering'} onClick={experiment.register}>실험 기준 등록 (8초)</button>
      <label>예측 방식 <select aria-label="예측 방식" value={experiment.predictor} onChange={e => experiment.setPredictor(e.target.value as typeof experiment.predictor)}>
        <option value="lstm">학습한 LSTM</option><option value="hold_last">마지막 위치 유지</option><option value="constant_velocity">등속 움직임</option>
      </select></label>
      <button className="btn" disabled={!r} onClick={experiment.download}>실험 결과 내려받기</button>
    </div>
    {(experiment.error || camera.error) && <p role="alert">{experiment.error || camera.error}</p>}
    {!experiment.model && !experiment.error && <p role="status">학습 모델을 준비하고 있어요…</p>}
    <div className="collection-layout">
      <div className="collection-preview"><div className="stage"><CameraStage camera={camera} />
        <div className="stage-overlay"><div className="stage-top"><span className="stage-tag">MediaPipe Heavy</span>
          <span className="stage-tag">{camera.metrics.fps.toFixed(1)} FPS</span></div></div></div>
        <VisualControls camera={camera} />
        <ol className="forecast-instructions"><li>카메라를 켜고 편안한 자세로 8초 기준을 등록합니다.</li>
          <li>짧게 고개를 움직였다 돌아오기, 천천히 기울인 채 유지하기, 갑자기 기울인 채 유지하기를 비교합니다.</li>
          <li>예측 방식을 바꾸면 해당 방식의 기준을 다시 등록합니다. 카메라 위치를 바꿔도 다시 등록해 주세요.</li></ol>
      </div>
      <section className="forecast-results" aria-label="실시간 예측 실험 결과">
        <div className="forecast-result"><h2>예측 + 거리·시간</h2><p role="status">{camera.state !== 'on' ? '카메라를 켜 주세요' : labels[r?.state ?? 'needs_reference']}</p>
          {r?.state === 'registering' && <progress aria-label="실험 기준 등록 진행" max={1} value={r.progress} />}</div>
        <div className="forecast-result"><h2>거리·시간만</h2><p>{camera.state !== 'on' ? '카메라를 켜 주세요' : labels[r?.ruleState ?? 'needs_reference']}</p></div>
        <dl className="forecast-metrics"><div><dt>기준에서 벗어난 거리</dt><dd>{percentage(r?.deviation)}</dd></div>
          <div><dt>0.3초 예측 오차</dt><dd>{percentage(r?.error)}</dd></div>
          <div><dt>등록 중 관측한 오차 한계</dt><dd>{percentage(r?.errorLimit)}</dd></div>
          <div><dt>이번 연속 이탈</dt><dd>{r ? `${(r.durationMs / 1000).toFixed(1)}초` : '—'}</dd></div>
          <div><dt>짧게 벗어났다가 돌아온 횟수</dt><dd>{r?.returnedExcursions ?? 0}회</dd></div></dl>
        <p className="fine">%는 어깨 너비에 대한 좌표 거리입니다. 정확도나 정상 확률이 아닙니다.</p>
        <p className="fine">예측 오차가 커도 5초간 이탈을 유지하면 후보로 표시합니다. 가림·시간 누락은 누적을 끊습니다.</p>
        <p className="fine">영상·원본 좌표는 저장·전송하지 않습니다. 내려받기에는 최근 5분 이내의 수치 진단만 포함됩니다.</p>
      </section>
    </div>
  </main>
}
