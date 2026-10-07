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
import { popupAlert } from '../desktop/alertPopup'
import type { SessionService } from './types'

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
  useEffect(()=>{if(isCamera)camera.face?.setPolicy(phase,rules.holdSeconds*1000)},[isCamera,phase,rules.holdSeconds])
  useEffect(()=>()=>{camera.face?.setPolicy('inactive',rules.holdSeconds*1000)},[])
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
            if (camera.face) return // Exclude the scheduling gap; resume on fresh face input.
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
    if (service || camera.face) return
    const hidden = () => {
      if (document.hidden) setPhase((p) => (p === 'running' ? 'paused' : p))
    }
    document.addEventListener('visibilitychange', hidden)
    return () => document.removeEventListener('visibilitychange', hidden)
  }, [service?.active])
  useEffect(() => {
    if (!service || !isCamera || phase !== 'running') return
    const timer = setInterval(() => {
      if (camera.state !== 'on' || (!camera.face && performance.now() - camera.lastFrame.current > 1500)) {
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
    popupAlert(active?.type ?? live.collapse, (active?.alerts ?? 1) > 1)
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
  const displayScore = isCamera&&camera.face?camera.face.score():postureScore(
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
