import { useEffect, useMemo, useRef, useState } from 'react'
import type { CameraController } from '../../hooks/useCamera'
import type { CollectionController } from '../../hooks/useCollection'
import { useSession, type SessionPhase } from '../../hooks/useSession'
import type { Rules } from '../../lib/engine'
import { cameraSample, holdWhileSettling, SHOULDER_MISSING_NOTICE } from '../../lib/cameraSample'
import { ReturnSettle } from '../../lib/returnSettle'
import { postureScore } from '../../lib/postureScore'
import { collapseIntervals, ratio } from '../../lib/stats'
import { enableSound, playCorrection } from '../../lib/sound'
import { popupAlert, popupNotice } from '../desktop/alertPopup'
import type { SessionService } from './types'
import { KafkaFeatureRecorder } from './kafkaExport'
import { PoseDebugRecorder } from './poseDebugExport'
import { CAMERA_ERRORS } from '../camera/errors'

type Options = {
  rules: Rules
  alertsOn: boolean
  camera: CameraController
  mode: 'camera' | 'demo'
  collection: CollectionController
  service?: SessionService
}

/** Controls screen lifecycle and alert delivery; timing classification stays in useSession. */
export function useSessionScreen({ rules, alertsOn, camera, mode, collection, service }: Options) {
  const [phase, setPhase] = useState<SessionPhase>(service?.initial ? 'paused' : 'running')
  const [speed, setSpeed] = useState(4)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [sessionRules] = useState(rules)
  if (service) rules = sessionRules
  const [soundOn, setSoundOn] = useState(false)
  const [soundError, setSoundError] = useState('')
  const [pauseReason, setPauseReason] = useState(
    service?.initial ? '저장된 기록을 불러왔어요. 준비되면 이어서 측정해 주세요.' : '',
  )
  const isCamera = mode === 'camera'
  const recorder = useRef<KafkaFeatureRecorder | null>(null)
  const debugRecorder = useRef<PoseDebugRecorder | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const [exportCount, setExportCount] = useState(0)
  const returnSettle = useRef(new ReturnSettle())
  useEffect(() => {
    if (!service?.sessionId || !isCamera) return
    return camera.subscribe((observation) => {
      if (!recorder.current) {
        if (!camera.baseline || !camera.calibrationId) return
        recorder.current = new KafkaFeatureRecorder({
          sessionId: service.sessionId!,
          userId: 'local',
          baselineId: camera.calibrationId,
          baseline: camera.baseline,
          rules,
          width: observation.width,
          height: observation.height,
          origin: observation.timeMs,
          startedAt: new Date().toISOString(),
        })
        debugRecorder.current = new PoseDebugRecorder(observation.timeMs)
      }
      if (phaseRef.current !== 'running') {
        recorder.current.pause()
        return
      }
      recorder.current.push(observation.timeMs, observation.features)
      debugRecorder.current?.push({
        timeMs: observation.timeMs,
        width: observation.width,
        height: observation.height,
        landmarks: observation.landmarks,
      })
    })
    // The recorder belongs to this session; camera identity changes do not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service?.sessionId, isCamera])
  const { live, reset, seekNext } = useSession(
    phase,
    speed,
    rules,
    isCamera
      ? () => holdWhileSettling(cameraSample(camera), returnSettle.current, performance.now())
      : undefined,
    alertsOn,
    service
      ? {
          initial: service.initial,
          checkpoint: service.onCheckpoint,
          ended: service.onEnded,
          interrupted: () => {
            setPauseReason('카메라 입력이 멈췄어요. 준비되면 직접 이어서 측정해 주세요.')
            setPhase('paused')
          },
        }
      : undefined,
  )
  useEffect(() => {
    collection.setPhase(isCamera ? phase : 'inactive')
  }, [phase, isCamera, collection.setPhase])
  useEffect(() => () => collection.setPhase('inactive'), [collection.setPhase])
  useEffect(() => {
    if (phase === 'ended' && isCamera) camera.stop()
  }, [phase])
  useEffect(() => {
    // In the app, measurement keeps running while another tab (e.g. records) is open;
    // the camera stays app-level and lost input still pauses via the check below.
    if (service) return
    const hidden = () => {
      if (document.hidden) setPhase((p) => (p === 'running' ? 'paused' : p))
    }
    document.addEventListener('visibilitychange', hidden)
    return () => document.removeEventListener('visibilitychange', hidden)
  }, [service?.active])
  /**
   * The camera in use was unplugged (its track ended): the measurement ends at once and what was
   * measured so far is saved (2026-10-16, plan 0053). It does not move to another camera; a new
   * measurement starts from 「측정하기」 with that camera's posture, or a new registration.
   */
  const [endReason, setEndReason] = useState('')
  useEffect(() => {
    if (!service || !isCamera || phase === 'ended') return
    if (camera.state === 'error' && camera.error === CAMERA_ERRORS.disconnected) {
      setEndReason('카메라 연결이 끊겨 측정을 끝냈어요. 끊기기 전까지의 기록은 저장했어요.')
      setPhase('ended')
    }
  }, [service, isCamera, phase, camera.state, camera.error])
  useEffect(() => {
    if (!service || !isCamera || phase !== 'running') return
    const timer = setInterval(() => {
      if (camera.state !== 'on' || performance.now() - camera.lastFrame.current > 1500) {
        setPauseReason('카메라 입력이 끊겼습니다. 카메라 준비를 확인하고 직접 재개해 주세요.')
        setPhase('paused')
      }
    }, 250)
    return () => clearInterval(timer)
  }, [service, isCamera, phase, camera.state])

  const muted = useMemo(
    () => new Set(live.events.filter((e) => e.alerts === 0).map((e) => e.id)),
    [live.events],
  )

  // 알림이 울린 순간에만 토스트를 띄운다
  const [toast, setToast] = useState<string | null>(null)
  const lastTick = useRef(0)
  useEffect(() => {
    if (live.alertTick === lastTick.current) return
    lastTick.current = live.alertTick
    if (!alertsOn || phase !== 'running' || live.state === 'unknown') return
    if (soundOn && !playCorrection())
      setSoundError('소리를 재생하지 못했습니다. 소리 켜기를 다시 눌러 주세요.')
    const active = live.events.find((event) => event.endAt === null)
    popupAlert((active?.alerts ?? 1) > 1)
    setToast(`흐트러진 자세가 ${rules.holdSeconds}초 이상 이어졌습니다.`)
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [live.alertTick])
  useEffect(() => {
    if (phase !== 'running' || live.state === 'unknown' || !alertsOn) setToast(null)
  }, [phase, live.state, alertsOn])

  // 어깨가 2초 넘게 화면을 벗어나 측정이 멈춘 순간 한 번 알린다(2026-10-13).
  const [shoulderToast, setShoulderToast] = useState<string | null>(null)
  const shoulderOut = phase === 'running' && live.notice === SHOULDER_MISSING_NOTICE
  useEffect(() => {
    if (!shoulderOut) {
      setShoulderToast(null)
      return
    }
    setShoulderToast('어깨가 화면에서 벗어나 측정을 잠시 멈췄어요.')
    if (alertsOn)
      popupNotice({
        title: '어깨가 보이지 않아요',
        body: '측정을 잠시 멈췄어요. 어깨가 화면에 들어오면 바로 이어가요.',
      })
    const t = setTimeout(() => setShoulderToast(null), 4000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shoulderOut])

  const keepRate = ratio(live.goodSeconds, live.validSeconds)
  const perHour = live.validSeconds > 0 ? live.events.length / (live.validSeconds / 3600) : null
  const displayScore = postureScore(
    live.state === 'unknown' || phase === 'paused' ? null : live.collapseProb,
  )
  const warningScore = postureScore(rules.threshold)!
  const overThreshold = live.collapseProb >= rules.threshold

  const { intervals, recoveries, mutedCount } = useMemo(() => {
    const gaps = collapseIntervals(live.events)
    const rec = live.events.filter((e) => e.recovered && e.recoverySec !== null && !muted.has(e.id))
    return {
      intervals: gaps,
      recoveries: rec.map((e) => e.recoverySec as number),
      mutedCount: live.events.filter((e) => muted.has(e.id)).length,
    }
  }, [live.events])

  /**
   * Downloads the intervals this measurement would have sent to Kafka (JSON Lines, .txt)
   * and, for analysis, the raw landmarks of the same frames (.csv).
   */
  function exportFeatures() {
    const current = recorder.current
    if (!current || !current.count) return false
    const id = service?.sessionId ?? 'session'
    download(current.toText(), `posegood-kafka-features-${id}.txt`, 'text/plain')
    const debug = debugRecorder.current
    // A short gap keeps the second save dialog from replacing the first one.
    if (debug?.count) setTimeout(() => download(debug.toCsv(), `posegood-pose-debug-${id}.csv`, 'text/csv'), 300)
    setExportCount(current.count)
    return true
  }

  function restartDemo() {
    lastTick.current = 0
    reset()
    setPhase('running')
  }

  async function toggleSound() {
    if (soundOn) {
      setSoundOn(false)
      return
    }
    try {
      await enableSound()
      setSoundOn(true)
      setSoundError('')
    } catch {
      setSoundError('이 브라우저에서 소리를 켜지 못했습니다.')
    }
  }

  function togglePause() {
    setPauseReason('')
    setPhase(phase === 'paused' ? 'running' : 'paused')
  }

  return {
    exportFeatures,
    exportCount,
    canExport: !!service?.sessionId && isCamera,
    rules,
    phase,
    setPhase,
    speed,
    setSpeed,
    showSkeleton,
    setShowSkeleton,
    soundOn,
    soundError,
    pauseReason,
    endReason,
    isCamera,
    live,
    seekNext,
    muted,
    toast,
    shoulderToast,
    keepRate,
    perHour,
    displayScore,
    warningScore,
    overThreshold,
    intervals,
    recoveries,
    mutedCount,
    restartDemo,
    toggleSound,
    togglePause,
  }
}

export type SessionScreen = ReturnType<typeof useSessionScreen>

function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.hidden = true
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
