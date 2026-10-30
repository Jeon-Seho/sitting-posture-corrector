import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowClockwise, ArrowCounterClockwise, Pause, Play } from '@phosphor-icons/react'
import { SelectMenu } from '../../components/SelectMenu'
import { ObservationPlayerSurface } from './ObservationPlayerSurface'
import { createPortal } from 'react-dom'
import { ObservationPreviewContext } from './ObservationPreviewContext'
import { taskTitle } from './comparisonDemo'
import { LIVE_FORECAST_ORDER } from '../../../../model/prototype/forecast'
import { boldNumbers } from './observationTypography'
import { downloadObservationReplay, replayFeatures, replayFrameAt, replayImageValid, replayIndexAt,
  type ObservationReplayData, type ReplayPhase } from './observationReplay'
import { DepthNote, ObservationMetrics } from './ObservationMetrics'
import { downloadObservationFeatures } from './observationFeatureExport'
import { replayMetricSeries, replayMetricsAt } from './observationReplayMetrics'
import { ObservationReplaySettings } from './ObservationReplaySettings'
import { ObservationReplayInfo } from './ObservationReplayInfo'
import { ReplayImportDialog } from './ReplayImportDialog'

const phaseLabels: Record<ReplayPhase, string> = { connecting: '연결', preparing: '기준 준비', registering: '기준 등록', interrupted: '등록 중단', idle: '대기', move: '준비', hold: '측정', return: '복귀 준비', waiting: '다음 대기', paused: '일시 정지', completed: '완료', cancelled: '중단' }
const clock = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2,'0')}:${(ms / 1000 % 60).toFixed(1).padStart(4,'0')}`
// Arm links only draw when both ends are visible; v1 files simply have no index 13+.
const links = [[2,5],[9,10],[0,11],[0,12],[11,12],[11,13],[13,15],[12,14],[14,16],[15,17],[15,19],[16,18],[16,20]]
type Props = { visible: boolean; active: boolean; count: number; dropped: number; getRecording: () => ObservationReplayData | null }
export function ObservationReplay({ visible, active, count, dropped, getRecording }: Props) {
  const [data, setData] = useState<ObservationReplayData | null>(null)
  const [position, setPosition] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1)
  const [view, setView] = useState<'image' | 'model-front' | 'model-side'>('image')
  const [importing, setImporting] = useState(false), [source, setSource] = useState<'cycle' | 'file'>('cycle')
  const lastCycle = useRef('')
  const preview = useContext(ObservationPreviewContext)
  const setReplayVisible = preview?.setReplayVisible
  useEffect(() => {
    setReplayVisible?.(visible && !active)
    return () => setReplayVisible?.(false)
  }, [visible, active, setReplayVisible])
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
      extractors: [...new Set(data.frames.map(f => f.poseModelId ?? '추출기 미상'))], metrics: replayMetricSeries(data) }
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
  const seek = (value: number) => { setPlaying(false); setPosition(Math.max(start, Math.min(end, value))) }
  const graph = data && summary ? replayMetricsAt(data, summary.metrics, position) : null
  const openImport = () => { setPlaying(false); setImporting(true) }
  const settings = <ObservationReplaySettings>
    <div className="oc-player-file-actions">
      <button disabled={active} aria-pressed={source === 'file' && !!data} onClick={openImport}>파일 불러오기</button>
      <button disabled={active || !count} aria-pressed={source === 'cycle' && !!data} onClick={currentRecording}>최근 측정 보기</button>
      <button disabled={active || !data} onClick={() => { if (data) downloadObservationReplay(data) }}>전체 데이터 JSON</button>
      <button disabled={active || !data} onClick={() => { if (data) downloadObservationFeatures(data) }}>ML 후보 특징 JSON</button>
    </div>
    <div className="oc-setting-field"><span>재생 속도</span><SelectMenu label="재생 속도" value={String(speed)} disabled={active || !data} onChange={value => setSpeed(Number(value))} options={[.25,.5,1,2].map(rate => ({ value: String(rate), label: `${rate}배` }))} /></div>
    <div className="oc-setting-field"><span>좌표 보기</span><SelectMenu label="리플레이 좌표 보기" value={view} disabled={active || !data} onChange={value => setView(value as typeof view)} options={[{ value: 'image', label: '화면 키포인트' }, { value: 'model-front', label: 'ML 입력 · 정면' }, { value: 'model-side', label: 'ML 입력 · 측면' }]} /></div>
    {data && <ObservationReplayInfo onOpen={() => setPlaying(false)}><p>{data.source === 'synthetic' ? '합성 예시' : source === 'cycle' ? '최근 측정' : '불러온 파일'} · 영상 미포함</p><p>{boldNumbers(`2D 유효 ${summary!.image.toLocaleString()} / ${data.frames.length.toLocaleString()}프레임 · 기존 39D 변환 가능 ${summary!.features.toLocaleString()}프레임`)}</p><p>{boldNumbers(`현재 ${metadata?.width}×${metadata?.height} · ${summary!.extractors.join(' / ')}${data.droppedFrames ? ` · 미기록 ${data.droppedFrames}프레임` : ''}`)}</p><p>기록된 안내 라벨이며 수행 정답이 아닙니다. 학습에는 라벨 검토와 참여자·회차 분리가 필요합니다.</p></ObservationReplayInfo>}
  </ObservationReplaySettings>
  const togglePlayback = () => {
    if (playing) setPlaying(false)
    else if (document.visibilityState !== 'hidden') { if (position >= end) setPosition(start); setPlaying(true) }
  }
  const transport = data && <>
    <button aria-label="5초 뒤로" title="5초 뒤로" disabled={active || position <= start} onClick={() => seek(position - 5000)}><span className="oc-skip-icon" aria-hidden="true"><ArrowCounterClockwise size={36} /><small>5</small></span></button>
    <button className="oc-play-toggle" aria-label={playing ? '재생 일시정지' : '재생'} title={playing ? '일시정지' : '재생'} disabled={active || end <= start} onClick={togglePlayback}>{playing ? <Pause size={40} weight="fill" aria-hidden="true" /> : <Play size={40} weight="fill" aria-hidden="true" />}</button>
    <button aria-label="5초 앞으로" title="5초 앞으로" disabled={active || position >= end} onClick={() => seek(position + 5000)}><span className="oc-skip-icon" aria-hidden="true"><ArrowClockwise size={36} /><small>5</small></span></button>
  </>
  const controls = data ? <div className="oc-player-controls" aria-label="리플레이 타임라인">
    <div className="oc-replay-timeline"><output aria-live="off">{boldNumbers(`${clock(position - start)} / ${clock(end - start)}`)}</output><input type="range" aria-label="리플레이 위치" min={start} max={end} step={1} style={{ '--oc-seek-progress': `${end > start ? (position - start) / (end - start) * 100 : 0}%` } as CSSProperties} value={position} disabled={active} onChange={event => seek(Number(event.currentTarget.value))} /></div>
  </div> : null
  const utilities = <div className="oc-player-utilities">{settings}</div>
  const posture = metadata ? taskTitle(metadata.task) ?? '라벨 없음' : '등록된 자세 없음'
  const badges = <div className="oc-replay-badges"><span className="oc-replay-posture" aria-label="현재 자세 라벨"><strong>{posture}</strong>{metadata && <small>{phaseLabels[metadata.phase]}</small>}</span></div>
  const stage = <ObservationPlayerSurface hasData={!!data} playing={playing} transport={transport} footer={<>{controls}{utilities}</>}>
    {data ? <><svg viewBox={view === 'image' ? `0 0 ${frame?.width ?? metadata?.width ?? 640} ${frame?.height ?? metadata?.height ?? 480}` : '-2 -2 4 4'} role="img" aria-label="영상 없는 키포인트 재생" className={`oc-replay-points${view === 'image' ? '' : ' oc-replay-model-points'}`}>
        {drawable && points && <g>{links.map(([a,b]) => { const p = points[a], q = points[b]; return p && q && (p.visibility ?? 0) >= .5 && (q.visibility ?? 0) >= .5 ? <line key={`${a}-${b}`} x1={p.x * width} y1={p.y * height} x2={q.x * width} y2={q.y * height} /> : null })}{points.map((p, i) => p && (p.visibility ?? 0) >= .5 && (view !== 'image' || p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) ? <circle key={i} cx={p.x * width} cy={p.y * height} r={view === 'image' ? width / 160 : .025}><title>{`${i}: ${p.x.toFixed(3)}, ${p.y.toFixed(3)}`}</title></circle> : null)}</g>}
      </svg>{!drawable && <p className="oc-replay-empty">{view === 'image' ? '이 구간은 관측이 없거나 추적이 불안정해요.' : '이 구간은 39D 학습 입력으로 변환할 수 없어요.'}</p>}</> : <p className="oc-replay-empty">재생할 기록이 없어요.</p>}
    {badges}
  </ObservationPlayerSurface>
  const previewStage = preview ? visible && !active && preview.replayHost ? createPortal(stage, preview.replayHost) : null : stage
  return <section className="oc-replay" aria-label="키포인트 리플레이">
    {active && <p>키포인트 기록 중</p>}
    {dropped > 0 && <p>{boldNumbers(`기록 한도 도달 · 이후 ${dropped.toLocaleString()}프레임은 기록하지 않았어요.`)}</p>}
    {importing && <ReplayImportDialog onCancel={() => setImporting(false)} onLoad={next => { if (!active) { load(next, 'file'); setImporting(false) } }} />}
    {previewStage}
    <ObservationMetrics samples={graph?.samples ?? []} values={graph?.values ?? null} depthNote={<DepthNote current={graph?.current ?? null} reference={graph?.reference ?? null} />} />
  </section>
}
