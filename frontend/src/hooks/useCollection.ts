import { useCallback, useEffect, useRef, useState } from 'react'
import { appendObservation, finishCapture, newCapture, reviewCapture, toCsv, type Capture } from '../lib/collection'
import { captureWindow, DEFAULT_CAPTURE_OPTIONS, PREPARE_MS, taskFor, type CaptureOptions, type Label, type Presence } from '../lib/collectionProtocol'
import type { Rules, SessionPhase } from '../lib/engine'
import type { CameraController } from './useCamera'

type Stage = 'idle' | 'countdown' | 'recording' | 'review'
export function useCollection(camera: CameraController, rules: Rules) {
  const capture = useRef<Capture | null>(null)
  const stageRef = useRef<Stage>('idle')
  const phaseRef = useRef<SessionPhase | 'inactive'>('inactive')
  const [stage, updateStage] = useState<Stage>('idle')
  const [phase, updatePhase] = useState(phaseRef.current)
  const [participant, setParticipant] = useState('P01')
  const [options, updateOptions] = useState<CaptureOptions>({ ...DEFAULT_CAPTURE_OPTIONS })
  const [label, setLabel] = useState<Label>('upright')
  const [presence, setPresence] = useState<Presence>('seated')
  const [count, setCount] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [downloaded, setDownloaded] = useState(false)
  const [message, setMessage] = useState('')
  const [review, setReview] = useState<Capture['review']>('pending')
  const [stopReason, setStopReason] = useState('')
  const setStage = useCallback((next: Stage) => { stageRef.current = next; updateStage(next) }, [])
  const active = stage === 'countdown' || stage === 'recording'
  const canStart = camera.state === 'on' && !!camera.baseline && phase === 'running' && stage === 'idle'

  const stop = useCallback((reason = 'manual_stop') => {
    const c = capture.current
    if (!c || stageRef.current === 'review') return
    finishCapture(c, reason); setStopReason(reason); setStage('review'); setCount(c.rows.length); setSecondsLeft(0)
    setMessage(reason === 'completed' ? '촬영을 마쳤습니다. 실제 수행한 자세와 재석 상태를 확인하세요.'
      : '촬영이 중단되었습니다. 이 구간은 학습용으로 확정할 수 없습니다. 제외 후 다시 촬영하세요.')
  }, [setStage])
  const setPhase = useCallback((next: SessionPhase | 'inactive') => {
    phaseRef.current = next; updatePhase(next)
    if (next !== 'running' && (stageRef.current === 'countdown' || stageRef.current === 'recording')) stop('session_interrupted')
  }, [stop])
  const tick = useCallback((now: number) => {
    const c = capture.current
    if (!c || !['countdown', 'recording'].includes(stageRef.current)) return
    const next = captureWindow(c.startMs, c.options.durationSeconds, now)
    if (next === 'review') { stop('completed'); return }
    if (next !== stageRef.current) setStage(next)
    setSecondsLeft(Math.max(0, Math.ceil((next === 'countdown' ? c.startMs - now : c.startMs + c.options.durationSeconds * 1000 - now) / 1000)))
    setCount(c.rows.length)
  }, [stop, setStage])

  useEffect(() => camera.subscribe(o => {
    const c = capture.current
    if (!c || phaseRef.current !== 'running' || document.hidden) return
    tick(o.timeMs)
    if (stageRef.current === 'recording') appendObservation(c, o, taskFor(c.options.taskId)!.posture)
  }), [camera.subscribe, tick])
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => tick(performance.now()), 100)
    return () => clearInterval(timer)
  }, [active, tick])
  useEffect(() => {
    if (camera.state !== 'on' && ['countdown', 'recording'].includes(stageRef.current)) stop('camera_disconnected')
  }, [camera.state, stop])
  useEffect(() => {
    const hidden = () => { if (document.hidden && ['countdown', 'recording'].includes(stageRef.current)) stop('tab_hidden') }
    document.addEventListener('visibilitychange', hidden)
    return () => document.removeEventListener('visibilitychange', hidden)
  }, [stop])
  useEffect(() => {
    if ((!count && !active) || downloaded) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [count > 0, active, downloaded])

  const setOptions = (patch: Partial<CaptureOptions>) => {
    if (stageRef.current !== 'idle') return
    updateOptions(old => ({ ...old, ...patch }))
  }
  const start = () => {
    if (!canStart || !camera.baseline || capture.current) return
    try {
      const task = taskFor(options.taskId)!
      capture.current = newCapture(participant.trim().toUpperCase(), camera.baseline, rules,
        performance.now() + PREPARE_MS, crypto.randomUUID(), new Date(Date.now() + PREPARE_MS).toISOString(), options, camera.calibrationId ?? 'unknown')
      setLabel(task.posture); setPresence(task.presence); setStage('countdown'); setSecondsLeft(PREPARE_MS / 1000)
      setCount(0); setDownloaded(false); setMessage(''); setReview('pending'); setStopReason('')
    } catch (error) { setMessage(error instanceof Error ? error.message : '촬영을 시작할 수 없습니다.') }
  }
  const confirm = (accepted: boolean) => {
    if (stageRef.current !== 'review' || !capture.current) return
    try {
      reviewCapture(capture.current, accepted, label, presence)
      setReview(capture.current.review); setDownloaded(false)
      setMessage(accepted ? '수행 내용 확인 완료. 자세 미지정 구간은 자세 분류 학습 대상에 포함되지 않습니다.' : '제외 표시 완료. 내려받아 원인을 분석하거나 다시 촬영할 수 있습니다.')
    } catch (error) { setMessage(error instanceof Error ? error.message : '라벨을 확인해 주세요.') }
  }
  const download = () => {
    if (stageRef.current !== 'review' || !capture.current?.rows.length || capture.current.review === 'pending') return
    const c = capture.current
    const url = URL.createObjectURL(new Blob([toCsv(c.rows)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `posture-pilot-${c.participant}-${c.id}.csv`
    link.hidden = true; document.body.appendChild(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000); setDownloaded(true)
    setMessage('CSV 다운로드를 요청했습니다. 브라우저 다운로드 목록에서 파일을 확인하세요.')
  }
  const clear = () => {
    if (['countdown', 'recording'].includes(stageRef.current)) return
    capture.current = null; setStage('idle'); setCount(0); setDownloaded(false); setMessage(''); setReview('pending'); setStopReason('')
    updateOptions(old => ({ ...old, repetition: Math.min(999, old.repetition + 1) }))
  }
  const goodCount = capture.current?.rows.filter(row => row.measurement_quality === 'good').length ?? 0
  return { participant, setParticipant, options, setOptions, label, setLabel, presence, setPresence,
    active, stage, secondsLeft, count, goodCount, downloaded, message, phase, review, stopReason,
    hasCapture: capture.current !== null, canStart, start, stop: () => stop(), setPhase, download, clear, confirm }
}
export type CollectionController = ReturnType<typeof useCollection>
