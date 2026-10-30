import { useEffect, useRef, useState } from 'react'
import type { CameraController } from '../../../hooks/useCamera'
import type { Rules } from '../../../lib/engine'
import { enableSound, playCorrection } from '../../../lib/sound'
import { popupAlert } from '../../desktop/alertPopup'
import { reportConnectionLost } from '../../connection/connectionLost'
import { publishMeasurementStatus, registerMeasurementEnd, type MeasurementStatus } from '../sessionControl'
import { LiveSession, type LiveState, type Policy, type SocketLike } from './LiveSession'

/** A measurement as the app starts it: the id for S1 and what it is judged against. */
export type LiveSessionDescriptor = {
  id: string
  startedAt: string
  rules: Rules
  baselineId: string
}

export type LiveSessionService = {
  /** The session tab is shown (the camera view is drawn only then). */
  active: boolean
  /** The measurement is over; `note` says why when it was not the user's 「측정 종료」. */
  onEnded: (state: LiveState, note: string) => void
  /** Every state change while measuring (the record's KST day split reads the running totals). */
  onObserved?: (state: LiveState) => void
  /** KST midnight: the previous session ended and was stored; the measurement goes on as a new one. */
  onRolledOver?: (previous: LiveState) => void
  /** "2026-10-13 · 세션 2", shown when the connection is lost. */
  sessionLabel?: string
}

type Options = {
  session: LiveSessionDescriptor
  camera: CameraController
  service: LiveSessionService
  alertsOn?: boolean
  openSocket?: (url: string) => SocketLike
}

/** Camera input over 1 s late pauses the measurement (`away`, FE proposal 3.2). */
export const INPUT_GAP_MS = 1000
export const INPUT_PAUSED_NOTICE = '인식 중입니다. 3초 후에 측정 재개 버튼을 눌러주세요.'
const CAMERA_UNPLUGGED = '쓰던 카메라가 빠져 측정을 마쳤어요. 그때까지의 기록은 저장했어요.'
const FRAME_CHANGED = '카메라 영상 크기가 바뀌어 측정을 마쳤어요. 그때까지의 기록은 저장했어요.'
export const ROLLED_OVER = '자정이 지나 새 측정으로 이어졌어요.'

const inputReady = (camera: CameraController) =>
  camera.state === 'on' && performance.now() - camera.lastFrame.current <= INPUT_GAP_MS

export function policyFor(rules: Rules): Policy {
  return {
    hold_ms: Math.round(rules.holdSeconds * 1000),
    recovery_ms: Math.round(rules.recoverSeconds * 1000),
    reminder_ms: Math.round(rules.realertSeconds * 1000),
    threshold: rules.threshold,
  }
}

/** React owns the camera, sound and window; LiveSession owns the server conversation. */
export function useLiveSession({ session, camera, service, alertsOn = true, openSocket }: Options) {
  const [state, setState] = useState<LiveState | null>(null)
  const [soundOn, setSoundOn] = useState(false)
  const [soundError, setSoundError] = useState('')
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [note, setNote] = useState('')
  /** A KST midnight `session_rollover` happened in this measurement (shown until it ends). */
  const [rolledOver, setRolledOver] = useState(false)
  /** Camera frames are arriving (checked every 250 ms, so 「측정 재개」 follows the camera). */
  const [inputOk, setInputOk] = useState(true)
  const live = useRef<LiveSession | null>(null)
  const latest = useRef({ camera, service, soundOn, alertsOn })
  latest.current = { camera, service, soundOn, alertsOn }
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noteRef = useRef('')

  useEffect(() => {
    const video = latest.current.camera.videoRef.current
    const size = video ? `${video.videoWidth}x${video.videoHeight}` : ''
    const endWith = (text: string) => {
      noteRef.current = text
      setNote(text)
      next.end()
    }
    const next = new LiveSession({
      sessionId: session.id,
      policy: policyFor(session.rules),
      baselineId: session.baselineId,
      openSocket,
      onChange: (changed) => {
        setState(changed)
        latest.current.service.onObserved?.(changed)
      },
      onAlert: (kind) => {
        if (!latest.current.alertsOn) return
        if (latest.current.soundOn && !playCorrection())
          setSoundError('소리를 재생하지 못했습니다. 소리 켜기를 다시 눌러 주세요.')
        popupAlert(kind === 'reminder')
        setToast(kind === 'reminder' ? '흐트러진 자세가 이어져 다시 알려드려요.' : '흐트러진 자세가 이어지고 있어요.')
        if (toastTimer.current !== null) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), 3000)
      },
      onRolledOver: (previous) => {
        latest.current.service.onRolledOver?.(previous)
        setRolledOver(true)
      },
      onEnded: (ended) => {
        latest.current.camera.stop()
        if (ended.lost) reportConnectionLost({ reason: 'realtime', session: latest.current.service.sessionLabel })
        latest.current.service.onEnded(ended, noteRef.current || ended.message)
      },
    })
    live.current = next
    setState(next.state)
    const unsubscribe = latest.current.camera.subscribe((frame) =>
      next.ingest(frame.timeMs, frame.landmarks, frame.shoulders !== 'missing'),
    )
    void next.start()
    const timer = setInterval(() => {
      if (next.state.phase === 'ended' || next.state.phase === 'failed') return
      next.tick()
      const cam = latest.current.camera
      // Decisions of 2026-10-16/21: an unplugged camera or a new frame size ends and saves.
      if (cam.state === 'error') {
        endWith(CAMERA_UNPLUGGED)
        return
      }
      const current = cam.videoRef.current
      if (size && current?.videoWidth && `${current.videoWidth}x${current.videoHeight}` !== size) {
        endWith(FRAME_CHANGED)
        return
      }
      const ok = inputReady(cam)
      setInputOk(ok)
      if (!ok) next.away()
    }, 250)
    return () => {
      unsubscribe()
      clearInterval(timer)
      if (toastTimer.current !== null) clearTimeout(toastTimer.current)
      next.dispose()
      live.current = null
    }
    // One measurement per session id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  const phase = state?.phase ?? 'creating'
  const over = phase === 'ended' || phase === 'failed'

  // The small camera window's X ends this measurement from any tab (2026-10-20).
  useEffect(() => {
    if (over) return
    return registerMeasurementEnd((reason) => {
      noteRef.current = reason
      setNote(reason)
      live.current?.end()
    })
  }, [over])

  const windowStatus: MeasurementStatus | null = over
    ? null
    : phase === 'running'
      ? state?.alerting
        ? 'alert'
        : state?.placeable && state?.observation?.valid
          ? 'good'
          : 'unknown'
      : phase === 'paused'
        ? 'paused'
        : 'unknown'
  useEffect(() => {
    publishMeasurementStatus(windowStatus)
  }, [windowStatus])
  useEffect(() => () => publishMeasurementStatus(null), [])

  useEffect(() => {
    if (phase !== 'running' || !alertsOn) setToast(null)
  }, [phase, alertsOn])

  async function toggleSound() {
    if (soundOn) {
      setSoundOn(false)
      return
    }
    try {
      await enableSound()
      setSoundOn(true)
      setSoundError('')
    } catch (caughtError) {
      console.error('[features/session/live/useLiveSession.ts:toggleSound] Operation failed', caughtError)
      setSoundError('이 브라우저에서 소리를 켜지 못했습니다.')
    }
  }


  return {
    state: state ?? live.current?.state ?? null,
    phase,
    note,
    rolledOver,
    soundOn,
    soundError,
    toggleSound,
    showSkeleton,
    setShowSkeleton,
    toast,
    /** Resuming needs the camera back (the away pause says 「측정 재개」 after it returns). */
    canResume: phase === 'paused' && inputOk && camera.quality,
    pause: () => live.current?.pause(),
    resume: () => {
      const cam = latest.current.camera
      if (inputReady(cam) && cam.quality) live.current?.resume()
    },
    end: () => live.current?.end(),
  }
}

export type LiveSessionScreen = ReturnType<typeof useLiveSession>
