import { useEffect, useRef, useState } from 'react'
import type { CameraController } from '../../hooks/useCamera'

/** Countdown before the 3 s capture starts, so the user can settle (user feedback 2026-10-12). */
export const REGISTRATION_COUNTDOWN_MS = 3000
/**
 * A capture that keeps restarting (an invalid frame resets it) or never collects enough
 * samples stops here and explains why, instead of looking stuck.
 */
export const REGISTRATION_LIMIT_MS = 15000

export type RegistrationPhase = 'waiting' | 'countdown' | 'capturing' | 'done' | 'stopped' | 'failed'

const TICK_MS = 100

/**
 * The 「자세 등록」 tab flow (plan 0024): once the face and both shoulders are visible it counts
 * down 3·2·1, captures the posture and ends by itself. It runs only on this tab and only
 * when there is no registered posture yet or the user asked to register again.
 */
export function usePostureRegistration(camera: CameraController, measuring: boolean) {
  const [armed, setArmed] = useState(() => !camera.baseline)
  const [phase, setPhase] = useState<RegistrationPhase>('waiting')
  const [now, setNow] = useState(() => performance.now())
  const countdownStart = useRef<number | null>(null)
  const captureStart = useRef<number | null>(null)
  const captureId = useRef<string | null>(null)
  const captureBaseline = useRef<CameraController['baseline']>(null)
  const sawProgress = useRef(false)
  const latest = useRef(camera)
  latest.current = camera

  const ready = camera.state === 'on' && camera.quality && !measuring
  const active = armed && (phase === 'waiting' || phase === 'countdown' || phase === 'capturing')

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(performance.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [active])

  useEffect(() => {
    if (!armed || measuring) return
    const cam = latest.current
    if (phase === 'waiting' || phase === 'countdown') {
      if (!ready) {
        countdownStart.current = null
        if (phase !== 'waiting') setPhase('waiting')
        return
      }
      if (countdownStart.current === null) {
        countdownStart.current = now
        setPhase('countdown')
        return
      }
      if (now - countdownStart.current >= REGISTRATION_COUNTDOWN_MS) {
        countdownStart.current = null
        captureStart.current = now
        captureId.current = cam.calibrationId
        captureBaseline.current = cam.baseline
        sawProgress.current = false
        cam.calibrate()
        setPhase('capturing')
      }
      return
    }
    if (phase !== 'capturing') return
    if (cam.progress !== null) sawProgress.current = true
    // A finished capture replaces the baseline; the id alone is not enough (it can repeat).
    if (cam.baseline && (cam.baseline !== captureBaseline.current || cam.calibrationId !== captureId.current)) {
      setPhase('done')
      setArmed(false)
      return
    }
    if (sawProgress.current && cam.progress === null) {
      // Cancelled outside this flow (camera turned off, tab change): wait and try again.
      setPhase('waiting')
      return
    }
    if (captureStart.current !== null && now - captureStart.current >= REGISTRATION_LIMIT_MS) {
      cam.cancelCalibration()
      setPhase('failed')
      setArmed(false)
    }
  }, [armed, measuring, phase, ready, now, camera.progress, camera.calibrationId, camera.baseline])

  const countdownLeft =
    phase === 'countdown' && countdownStart.current !== null
      ? Math.max(1, Math.ceil((REGISTRATION_COUNTDOWN_MS - (now - countdownStart.current)) / 1000))
      : null

  return {
    phase,
    armed,
    countdownLeft,
    /** 「측정 종료」: stops the countdown or capture and keeps any earlier registration. */
    stop() {
      latest.current.cancelCalibration()
      countdownStart.current = null
      setArmed(false)
      setPhase('stopped')
    },
    /** 「다시 등록」·「자세 등록 시작」: arms the automatic countdown again. */
    start() {
      if (measuring) return
      countdownStart.current = null
      setArmed(true)
      setPhase('waiting')
    },
  }
}
