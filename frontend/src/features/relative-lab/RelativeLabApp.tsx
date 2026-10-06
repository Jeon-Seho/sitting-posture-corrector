import { useEffect, useRef, useState } from 'react'
import { useCamera } from '../../hooks/useCamera'
import { classify, referenceScore } from '../../../../model/prototype/pose'
import { inferLogits, relativeDelta, RelativeLabWindow, validateModel, type LabModel, type LabState } from '../../../../model/prototype/relativeLab'
import './lab.css'

const names: Record<LabState, string> = { normal: '기준 범위 유지', movement: '움직임 · 평가 보류', deviation: '지속적 이탈 후보', waiting: '시간 흐름 확인 중', unmeasurable: '측정할 수 없어요' }
export default function RelativeLabApp() {
  const camera = useCamera()
  const [model, setModel] = useState<LabModel | null>(null)
  const [error, setError] = useState('')
  const [state, setState] = useState<LabState>('waiting')
  const [score, setScore] = useState(100)
  const [oldScore, setOldScore] = useState<number | null>(null)
  const [oldState, setOldState] = useState('기준 등록 전')
  const [probabilities, setProbabilities] = useState<number[]>([])
  const [delta, setDelta] = useState<number[]>([])
  const [demo, setDemo] = useState(false)
  const [records, setRecords] = useState(0)
  const windowRef = useRef(new RelativeLabWindow())
  const latest = useRef<number[][] | null>(null)
  const saved = useRef<{ label: number; reviewed: boolean; sequence: number[][]; timesMs: number[] }[]>([])
  const captureId = useRef(crypto.randomUUID())
  const [participantCode, setParticipantCode] = useState('')
  const [recordNotice, setRecordNotice] = useState('')
  const previousEvaluation = useRef<number | null>(null)
  const pending = useRef<number | null>(null)
  const lastFrame = useRef(0)
  const lastObservation = useRef<number | null>(null)
  const [holdMs, setHoldMs] = useState(1500)

  useEffect(() => {
    let active = true
    fetch('/lab-model.json').then(r => { if (!r.ok) throw new Error('학습 모델 파일을 찾을 수 없습니다. 학습 실행기를 먼저 실행해 주세요.'); return r.json() })
      .then(value => { if (active) setModel(validateModel(value)) }).catch(e => { if (active) setError(String(e.message)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    captureId.current = crypto.randomUUID(); saved.current = []; setRecords(0)
  }, [camera.baseline])

  useEffect(() => {
    if (demo) return
    windowRef.current.reset(); latest.current = null; pending.current = null; previousEvaluation.current = null
    lastObservation.current = null
    setState('waiting')
    setScore(100)
    if (!model) return
    return camera.subscribe(observation => {
      lastFrame.current = performance.now()
      if (!camera.baseline) { setState('waiting'); windowRef.current.reset(); return }
      const relative = relativeDelta(observation.landmarks, observation.width, observation.height, camera.baseline)
      if (lastObservation.current !== null && (observation.timeMs - lastObservation.current > 350 || observation.timeMs <= lastObservation.current)) {
        windowRef.current.reset(); latest.current = null; pending.current = null; previousEvaluation.current = null; setState('waiting')
      }
      lastObservation.current = observation.timeMs
      setDelta(relative ?? [])
      const rule = classify(observation.features, camera.baseline)
      setOldState(rule.status === 'normal' ? '정상' : rule.status === 'deviation' ? '이탈' : '측정 불가')
      const old = observation.features ? referenceScore(observation.features, camera.baseline).score : null
      setOldScore(old === null ? null : Math.round((1 - old) * 100))
      const rows = windowRef.current.push(observation.timeMs, relative)
      if (!relative) { setState('unmeasurable'); pending.current = null; previousEvaluation.current = null; latest.current = null; setProbabilities([]); return }
      if (!rows) { if (!latest.current) setState('waiting'); return }
      latest.current = rows
      const logits = inferLogits(model, rows)
      const exp = logits.map(v => Math.exp(v - Math.max(...logits)))
      const probs = exp.map(v => v / exp.reduce((a, b) => a + b, 0))
      setProbabilities(probs)
      const winner = probs.indexOf(Math.max(...probs))
      const elapsed = previousEvaluation.current === null ? 0 : Math.min(250, observation.timeMs - previousEvaluation.current)
      previousEvaluation.current = observation.timeMs
      if (probs[winner] < .7 || winner === 1) { pending.current = null; setState('movement'); return }
      if (winner === 0) { pending.current = null; setState('normal'); setScore(v => Math.min(100, v + elapsed / 1000)); return }
      pending.current ??= observation.timeMs
      if (observation.timeMs - pending.current < holdMs) { setState('waiting'); return }
      setState('deviation')
      setScore(v => Math.max(0, v - elapsed * 2 / 1000))
    })
  }, [model, demo, camera.subscribe, camera.baseline, holdMs])

  useEffect(() => {
    if (demo) return
    const timer = setInterval(() => {
      if (camera.state !== 'on' || (lastFrame.current && performance.now() - lastFrame.current > 1000)) {
        windowRef.current.reset(); latest.current = null; pending.current = null; previousEvaluation.current = null
        setState('unmeasurable'); setOldScore(null); setProbabilities([])
      }
    }, 250)
    return () => clearInterval(timer)
  }, [demo, camera.state])

  function runDemo(label: number) {
    if (!model) return
    camera.stop(); setDemo(true)
    const rows = Array.from({ length: 30 }, (_, t) => {
      const value = label === 0 ? .01 * Math.sin(t / 8) : label === 1 ? .45 * Math.sin(t / 4) : .45
      const before = label === 0 ? .01 * Math.sin((t - 1) / 8) : label === 1 ? .45 * Math.sin((t - 1) / 4) : .45
      return [0, value, 0, 0, t ? value - before : 0, 0]
    })
    latest.current = rows
    const logits = inferLogits(model, rows), exp = logits.map(v => Math.exp(v - Math.max(...logits)))
    const p = exp.map(v => v / exp.reduce((a, b) => a + b, 0))
    setProbabilities(p); setState((['normal', 'movement', 'deviation'] as const)[p.indexOf(Math.max(...p))])
    setOldState('합성 예시'); setOldScore(null); setDelta(rows.at(-1)!.slice(0, 3))
  }
  function record(label: number) {
    if (!latest.current || demo) return
    const timesMs = windowRef.current.getTimes()
    if (timesMs.length !== 30) return
    if (saved.current.some(r => timesMs[0] <= r.timesMs[29])) { setRecordNotice('이전 저장 구간과 겹쳐요. 새 관찰 구간이 채워진 뒤 저장해 주세요.'); return }
    saved.current.push({ label, reviewed: true, timesMs, sequence: latest.current.map(r => [...r]) }); setRecords(saved.current.length); setRecordNotice('직접 검토한 구간을 메모리에 저장했어요.')
  }
  function download() {
    const blob = new Blob([JSON.stringify({ version: 1, synthetic: false, participantCode: participantCode.trim(), captureId: captureId.current, featureVersion: 'relative-delta-velocity-v1', records: saved.current })], { type: 'application/json' })
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'relative-lab-reviewed.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <main className="relative-lab">
    <header><span className="lab-badge">PoseGood 실험실 · GP-0122</span><h1>움직임은 편하게, 평가는 천천히.</h1><p>{model?.synthetic === false ? '검토한 좌표 자료로 학습한' : '제작한 스켈레톤 좌표로 학습한'} LSTM 테스트 앱입니다. 실제 자세 정확도와 스트레칭 인식은 검증 전입니다.</p></header>
    {error && <p role="alert">{error}</p>}{camera.error && <p role="alert">{camera.error}</p>}
    <div className="lab-grid"><section className="lab-camera"><video ref={camera.videoRef} muted playsInline /><canvas ref={camera.canvasRef} />{demo && <div className="lab-demo">합성 시퀀스 미리보기 · 실제 카메라 아님</div>}</section>
    <section className="lab-card"><h2>{names[state]}</h2><p>실험 누적 점수</p><strong className="lab-score">{Math.round(score)}</strong><p>움직임·확인 중·측정 불가 구간에는 감점하지 않습니다.</p><hr /><p>기존 순간 규칙: {oldState} {oldScore !== null && `· ${oldScore}점`}</p><p>기존 점수는 비교용 순간 표시입니다.</p>{probabilities.length > 0 && <ul>{model?.labels.map((label, i) => <li key={label}>{names[label as LabState]}: {(probabilities[i] * 100).toFixed(1)}% 모델 출력</li>)}</ul>}<small>모델 출력은 실제 정확도를 뜻하지 않습니다.</small></section></div>
    <section className="lab-controls"><button onClick={() => { setDemo(false); setScore(100); void camera.connect() }}>카메라 연결</button><button disabled={!camera.quality || camera.progress !== null || demo} onClick={() => camera.calibrate()}>기준 자세 등록 {camera.progress !== null && `${Math.round(camera.progress * 100)}%`}</button><button onClick={() => { camera.stop(); setDemo(false); setScore(100) }}>측정 종료</button>
    <label>추가 이탈 확인 <select value={holdMs} onChange={e => setHoldMs(Number(e.target.value))}><option value={1000}>1초</option><option value={1500}>1.5초</option><option value={3000}>3초</option></select></label></section>
    <p>최근 약 3초를 관찰한 뒤, 이탈 후보가 선택한 시간 동안 이어지면 감점합니다. 설정값은 실험용입니다. 카메라 연결·재등록 시 관찰을 다시 시작합니다.</p>
    <section className="lab-card"><h2>합성 입력으로 연결 확인</h2><div className="lab-controls">{['정상 유지', '일시적 움직임', '지속적 이탈'].map((label, i) => <button key={label} disabled={!model} onClick={() => runDemo(i)}>{label}</button>)}</div><p>상대 변화량: {delta.map(v => v.toFixed(3)).join(' / ') || '관찰 대기'}</p></section>
    <details className="lab-card"><summary>검토한 구간 저장 · 선택 사항</summary><p>영상은 저장하지 않습니다. 최근 관찰 구간의 특징을 직접 확인한 라벨로 임시 저장합니다. 다운로드 전까지 메모리에만 있으며 창을 닫거나 기준을 재등록하면 사라집니다. 겹치는 구간은 저장하지 않습니다.</p><label>익명 참여자 코드 <input value={participantCode} onChange={e => setParticipantCode(e.target.value)} placeholder="예: P01 · 이름 대신 코드" /></label><div className="lab-controls">{['정상', '움직임', '이탈'].map((label, i) => <button key={label} disabled={!camera.baseline || demo || state === 'unmeasurable' || state === 'waiting'} onClick={() => record(i)}>{label}로 저장</button>)}<button disabled={!records || !participantCode.trim()} onClick={download}>좌표 특징 다운로드 ({records})</button></div><p role="status">{recordNotice}</p></details>
  </main>
}
