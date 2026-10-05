import { useCallback, useEffect, useRef, useState } from 'react'
import {
  appendObservation,
  finishCapture,
  newCapture,
  reviewCapture,
  toCsv,
  type Capture,
} from '../lib/collection'
import {
  captureWindow,
  DEFAULT_CAPTURE_OPTIONS,
  PREPARE_MS,
  taskFor,
  type CaptureOptions,
  type Label,
  type Presence,
} from '../lib/collectionProtocol'
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
  const setStage = useCallback((next: Stage) => {
    stageRef.current = next
    updateStage(next)
  }, [])
  const active = stage === 'countdown' || stage === 'recording'
  const canStart =
    camera.state === 'on' &&
    !!camera.baseline &&
    camera.progress === null &&
    phase === 'running' &&
    stage === 'idle'

  const stop = useCallback(
    (reason = 'manual_stop') => {
      const c = capture.current
      if (!c || stageRef.current === 'review') return
      finishCapture(c, reason)
      setStopReason(reason)
      setStage('review')
      setCount(c.rows.length)
      setSecondsLeft(0)
      setMessage(
        reason === 'completed'
          ? '촬영을 마쳤어요. 방금 어떤 자세였는지 골라 주세요.'
          : '촬영이 중간에 멈췄어요. 이 기록은 학습에 쓸 수 없으니 제외한 뒤 다시 찍어 주세요.',
      )
    },
    [setStage],
  )
  const setPhase = useCallback(
    (next: SessionPhase | 'inactive') => {
      phaseRef.current = next
      updatePhase(next)
      if (
        next !== 'running' &&
        (stageRef.current === 'countdown' || stageRef.current === 'recording')
      )
        stop('session_interrupted')
    },
    [stop],
  )
  const tick = useCallback(
    (now: number) => {
      const c = capture.current
      if (!c || !['countdown', 'recording'].includes(stageRef.current)) return
      const next = captureWindow(c.startMs, c.options.durationSeconds, now)
      if (next === 'review') {
        stop('completed')
        return
      }
      if (next !== stageRef.current) setStage(next)
      setSecondsLeft(
        Math.max(
          0,
          Math.ceil(
            (next === 'countdown'
              ? c.startMs - now
              : c.startMs + c.options.durationSeconds * 1000 - now) / 1000,
          ),
        ),
      )
      setCount(c.rows.length)
    },
    [stop, setStage],
  )

  useEffect(
    () =>
      camera.subscribe((o) => {
        const c = capture.current
        if (!c || phaseRef.current !== 'running' || document.hidden) return
        tick(o.timeMs)
        if (stageRef.current === 'recording')
          appendObservation(c, o, taskFor(c.options.taskId)!.posture)
      }),
    [camera.subscribe, tick],
  )
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => tick(performance.now()), 100)
    return () => clearInterval(timer)
  }, [active, tick])
  useEffect(() => {
    if (camera.state !== 'on' && ['countdown', 'recording'].includes(stageRef.current))
      stop('camera_disconnected')
  }, [camera.state, stop])
  useEffect(() => {
    const hidden = () => {
      if (document.hidden && ['countdown', 'recording'].includes(stageRef.current))
        stop('tab_hidden')
    }
    document.addEventListener('visibilitychange', hidden)
    return () => document.removeEventListener('visibilitychange', hidden)
  }, [stop])
  useEffect(() => {
    if ((!count && !active) || downloaded) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [count > 0, active, downloaded])

  const setOptions = (patch: Partial<CaptureOptions>) => {
    if (stageRef.current !== 'idle') return
    updateOptions((old) => ({ ...old, ...patch }))
  }
  const start = () => {
    if (!canStart || !camera.baseline || capture.current) return
    try {
      const task = taskFor(options.taskId)!
      capture.current = newCapture(
        participant.trim().toUpperCase(),
        camera.baseline,
        rules,
        performance.now() + PREPARE_MS,
        crypto.randomUUID(),
        new Date(Date.now() + PREPARE_MS).toISOString(),
        options,
        camera.calibrationId ?? 'unknown',
      )
      setLabel(task.posture)
      setPresence(task.presence)
      setStage('countdown')
      setSecondsLeft(PREPARE_MS / 1000)
      setCount(0)
      setDownloaded(false)
      setMessage('')
      setReview('pending')
      setStopReason('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '촬영을 시작할 수 없습니다.')
    }
  }
  const confirm = (accepted: boolean) => {
    if (stageRef.current !== 'review' || !capture.current) return
    try {
      reviewCapture(capture.current, accepted, label, presence)
      setReview(capture.current.review)
      setDownloaded(false)
      setMessage(
        accepted
          ? '확인했어요. 자세를 ‘확인 불가’로 고른 기록은 자세 구별 학습에는 쓰이지 않아요.'
          : '제외했어요. ‘다음 자세 찍기’로 다시 찍을 수 있어요.',
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '고른 자세를 확인해 주세요.')
    }
  }
  const download = () => {
    if (
      stageRef.current !== 'review' ||
      !capture.current?.rows.length ||
      capture.current.review === 'pending'
    )
      return
    const c = capture.current
    const url = URL.createObjectURL(new Blob([toCsv(c.rows)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `posture-pilot-${c.participant}-${c.id}.csv`
    link.hidden = true
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    setDownloaded(true)
    setMessage('파일을 내려받았어요. 브라우저의 다운로드 목록에서 확인해 주세요.')
  }
  const clear = () => {
    if (['countdown', 'recording'].includes(stageRef.current)) return
    capture.current = null
    setStage('idle')
    setCount(0)
    setDownloaded(false)
    setMessage('')
    setReview('pending')
    setStopReason('')
    updateOptions((old) => ({ ...old, repetition: Math.min(999, old.repetition + 1) }))
  }
  const goodCount =
    capture.current?.rows.filter((row) => row.measurement_quality === 'good').length ?? 0
  return {
    participant,
    setParticipant,
    options,
    setOptions,
    label,
    setLabel,
    presence,
    setPresence,
    active,
    stage,
    secondsLeft,
    count,
    goodCount,
    downloaded,
    message,
    phase,
    review,
    stopReason,
    hasCapture: capture.current !== null,
    canStart,
    start,
    stop: () => stop(),
    setPhase,
    download,
    clear,
    confirm,
  }
}
export type CollectionController = ReturnType<typeof useCollection>
