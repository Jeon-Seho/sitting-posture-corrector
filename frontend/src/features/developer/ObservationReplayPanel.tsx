import { useEffect, useMemo, useRef, useState } from 'react'
import { COMPARISON_ACTIONS } from './comparisonDemo'
import { LIVE_FORECAST_ORDER } from '../../../../model/prototype/forecast'
import { boldNumbers } from './observationTypography'
import { downloadObservationReplay, replayFeatures, replayFrameAt, replayImageValid, replayIndexAt,
  type ObservationReplayData, type ReplayPhase } from './observationReplay'
import { ReplayImportDialog } from './ReplayImportDialog'

const phaseLabels: Record<ReplayPhase, string> = { connecting: '연결', preparing: '기준 준비', registering: '기준 등록', interrupted: '등록 중단', idle: '대기', move: '준비', hold: '측정', return: '복귀 준비', waiting: '다음 대기', paused: '일시 정지', completed: '완료', cancelled: '중단' }
const clock = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2,'0')}:${(ms / 1000 % 60).toFixed(1).padStart(4,'0')}`
const links = [[2,5],[9,10],[0,11],[0,12],[11,12]]
type Props = { visible: boolean; active: boolean; count: number; dropped: number; getRecording: () => ObservationReplayData | null }
export function ObservationReplay({ visible, active, count, dropped, getRecording }: Props) {
  const [data, setData] = useState<ObservationReplayData | null>(null)
  const [position, setPosition] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1)
  const [view, setView] = useState<'image' | 'model-front' | 'model-side'>('image')
  const [importing, setImporting] = useState(false), [source, setSource] = useState<'cycle' | 'file'>('cycle')
  const lastCycle = useRef('')
  const start = data?.frames[0].elapsedMs ?? 0
  const end = data ? Math.max(data.frames.at(-1)!.elapsedMs, data.markers.at(-1)?.elapsedMs ?? 0) : 0
  useEffect(() => {
    if (!visible || active) { setPlaying(false); setImporting(false) }
    if (active) { setData(null); setSource('cycle'); lastCycle.current = '' }
  }, [visible, active])
  useEffect(() => {
    if (active || !count) return
    const next = getRecording()
    if (!next) return
    const key = `${next.runId}:${next.frames.length}:${next.markers.length}:${next.droppedFrames}`
    if (lastCycle.current === key) return
    lastCycle.current = key
    setData(next); setPosition(next.frames[0].elapsedMs); setPlaying(false); setSource('cycle'); setImporting(false)
  }, [active, count, getRecording])
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') setPlaying(false) }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])
  useEffect(() => {
    if (!playing || !visible || active || !data) return
    let previous = performance.now()
    const timer = setInterval(() => {
      const now = performance.now(), delta = Math.max(0, now - previous) * speed; previous = now
      setPosition(value => Math.min(end, value + delta))
    }, 40)
    return () => clearInterval(timer)
  }, [playing, visible, active, data, end, speed])
  useEffect(() => { if (position >= end) setPlaying(false) }, [position, end])
  const summary = useMemo(() => {
    if (!data) return null
    return { image: data.frames.filter(replayImageValid).length, features: data.frames.filter(f => replayFeatures(f) !== null).length,
      extractors: [...new Set(data.frames.map(f => f.poseModelId ?? '추출기 미상'))] }
  }, [data])
  const load = (next: ObservationReplayData, from: 'cycle' | 'file') => { setData(next); setPosition(next.frames[0].elapsedMs); setPlaying(false); setSource(from) }
  const currentRecording = () => { if (!active) { const next = getRecording(); if (next) load(next, 'cycle') } }
  const frame = data ? replayFrameAt(data, position) : null
  const imageValid = frame && replayImageValid(frame)
  const features = frame ? replayFeatures(frame) : null
  const points = view === 'image' ? frame?.image : features ? Array.from({length: 13}, (_, i) => {
    const index = LIVE_FORECAST_ORDER.indexOf(i) * 3
    return { x: features[index + (view === 'model-side' ? 2 : 0)], y: features[index + 1], visibility: 1 }
  }) : null
  const drawable = view === 'image' ? imageValid : !!features
  const width = view === 'image' ? frame?.width ?? 640 : 1, height = view === 'image' ? frame?.height ?? 480 : 1
  const metadata = data?.frames[Math.max(0, replayIndexAt(data.frames, position))]
  const index = data ? replayIndexAt(data.frames, position) : -1
  const seek = (value: number) => { setPlaying(false); setPosition(Math.max(start, Math.min(end, value))) }
  const step = (direction: number) => { if (data) seek(data.frames[Math.max(0, Math.min(data.frames.length - 1, index + direction))].elapsedMs) }
  return <section className="oc-replay" aria-label="키포인트 리플레이">
    <div className="oc-replay-heading"><div><h2>키포인트 리플레이</h2>{active && <p>키포인트 기록 중</p>}{dropped > 0 && <p>{boldNumbers(`기록 한도 도달 · 이후 ${dropped.toLocaleString()}프레임은 기록하지 않았어요.`)}</p>}</div>
      <div className="oc-replay-files"><button disabled={active || !count} aria-pressed={source === 'cycle' && !!data} onClick={currentRecording}>측정 사이클</button><button disabled={active} aria-pressed={source === 'file' && !!data} onClick={() => { setPlaying(false); setImporting(true) }}>파일 불러오기</button><button disabled={active || !data} onClick={() => { if (data) downloadObservationReplay(data) }}>키포인트 JSON 저장</button></div>
    </div>
    {importing && <ReplayImportDialog onCancel={() => setImporting(false)} onLoad={next => { if (!active) { load(next, 'file'); setImporting(false) } }} />}
    {data && <>
      <div className="oc-replay-controls oc-replay-view"><label>보기<select aria-label="리플레이 좌표 보기" value={view} onChange={event => setView(event.currentTarget.value as typeof view)}><option value="image">화면 키포인트</option><option value="model-front">ML 입력 · 정면</option><option value="model-side">ML 입력 · 측면</option></select></label><p>{view === 'image' ? '원래 화면 좌표 · 좌우 반전' : '기존 39D 입력 · 어깨 중심·폭 정규화 · 추정 좌표'}</p></div>
      <div className="oc-replay-stage"><svg viewBox={view === 'image' ? `0 0 ${frame?.width ?? metadata?.width ?? 640} ${frame?.height ?? metadata?.height ?? 480}` : '-2 -2 4 4'} role="img" aria-label="영상 없는 키포인트 재생" className={`oc-replay-points${view === 'image' ? '' : ' oc-replay-model-points'}`}>
        {drawable && points && <g>{links.map(([a,b]) => { const p = points[a], q = points[b]; return p && q && (p.visibility ?? 0) >= .5 && (q.visibility ?? 0) >= .5 ? <line key={`${a}-${b}`} x1={p.x * width} y1={p.y * height} x2={q.x * width} y2={q.y * height} /> : null })}{points.map((p, i) => p && (p.visibility ?? 0) >= .5 && (view !== 'image' || p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) ? <circle key={i} cx={p.x * width} cy={p.y * height} r={view === 'image' ? width / 160 : .025}><title>{`${i}: ${p.x.toFixed(3)}, ${p.y.toFixed(3)}`}</title></circle> : null)}</g>}
      </svg>{!drawable && <p className="oc-replay-empty">{view === 'image' ? '이 구간은 관측이 없거나 추적이 불안정해요.' : '이 구간은 39D 학습 입력으로 변환할 수 없어요.'}</p>}
        <div className="oc-replay-badges"><span>{data.source === 'synthetic' ? '합성 예시' : source === 'cycle' ? '측정 사이클' : '파일 재생'} · 영상 없음</span><span>{metadata ? `${COMPARISON_ACTIONS.find(a => a.id === metadata.task)?.title} · ${phaseLabels[metadata.phase]}` : '대기'}</span></div>
      </div>
      <div className="oc-replay-timeline"><output aria-live="off">{boldNumbers(`${clock(position - start)} / ${clock(end - start)}`)}</output><input type="range" aria-label="리플레이 위치" min={start} max={end} step={1} value={position} disabled={active} onChange={event => seek(Number(event.currentTarget.value))} /></div>
      <div className="oc-replay-controls"><button disabled={active || end <= start} onClick={() => { if (playing) setPlaying(false); else { if (document.visibilityState === 'hidden') return; if (position >= end) setPosition(start); setPlaying(true) } }}>{playing ? '재생 일시정지' : '재생'}</button><button disabled={active} onClick={() => seek(start)}>처음으로</button><button disabled={active || index <= 0} onClick={() => step(-1)}>이전 프레임</button><button disabled={active || index >= data.frames.length - 1} onClick={() => step(1)}>다음 프레임</button><label>재생 속도<select aria-label="재생 속도" value={speed} disabled={active} onChange={event => setSpeed(Number(event.currentTarget.value))}>{[.25,.5,1,2].map(rate => <option key={rate} value={rate}>{rate}배</option>)}</select></label></div>
      <div className="oc-replay-summary"><p>{boldNumbers(`2D 유효 ${summary!.image.toLocaleString()} / ${data.frames.length.toLocaleString()}프레임 · 기존 39D 변환 가능 ${summary!.features.toLocaleString()}프레임`)}</p><p>{boldNumbers(`현재 ${metadata?.width}×${metadata?.height} · ${summary!.extractors.join(' / ')}${data.droppedFrames ? ` · 미기록 ${data.droppedFrames}프레임` : ''}`)}</p><p>좌표 입력 점검용입니다. 안내 동작은 수행 정답이 아니며, 학습에는 라벨 검토와 참여자·회차 분리가 필요합니다. 이 JSON은 기존 학습기에 바로 넣는 형식이 아닙니다.</p></div>
    </>}
  </section>
}
