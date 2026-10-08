import { useEffect, useMemo, useRef, useState } from 'react'
import type { CameraController } from '../../hooks/useCamera'
import type { CollectionController } from '../../hooks/useCollection'
import { useSession, type SessionPhase } from '../../hooks/useSession'
import { COLLAPSE_LABEL } from '../../data/posture'
import type { Rules } from '../../lib/engine'
import { cameraSample } from '../../lib/cameraSample'
import { postureScore } from '../../lib/postureScore'
import { collapseIntervals, ratio } from '../../lib/stats'
import { enableSound, playCorrection } from '../../lib/sound'
import type { SessionService } from './types'
import { KafkaFeatureRecorder } from './kafkaExport'
import { PoseDebugRecorder } from './poseDebugExport'

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
    service?.initial ? '저장된 기록을 복구했습니다. 준비 후 재개해 주세요.' : '',
  )
  const isCamera = mode === 'camera'
  const recorder = useRef<KafkaFeatureRecorder | null>(null)
  const debugRecorder = useRef<PoseDebugRecorder | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const [exportCount, setExportCount] = useState(0)
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
        debugRecorder.current = new PoseDebugRecorder(observation.timeMs, camera.baseline, rules.threshold)
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
        features: observation.features,
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
    isCamera ? () => cameraSample(camera) : undefined,
    alertsOn,
    service
      ? {
          initial: service.initial,
          checkpoint: service.onCheckpoint,
          ended: service.onEnded,
          interrupted: () => {
            setPauseReason('관측 입력이 중단됐습니다. 준비 후 직접 재개해 주세요.')
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
    setToast(
      live.collapse
        ? `${COLLAPSE_LABEL[live.collapse]} 상태가 ${rules.holdSeconds}초 이상 이어졌습니다.`
        : '자세 붕괴가 감지되었습니다.',
    )
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [live.alertTick])
  useEffect(() => {
    if (phase !== 'running' || live.state === 'unknown' || !alertsOn) setToast(null)
  }, [phase, live.state, alertsOn])

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
    isCamera,
    live,
    seekNext,
    muted,
    toast,
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
