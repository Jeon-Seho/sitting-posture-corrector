import { useEffect, useRef, useState } from 'react'
import type { CameraController } from '../../hooks/useCamera'

/** Countdown before the 3 s capture starts, so the user can settle (user feedback 2026-10-12). */
export const REGISTRATION_COUNTDOWN_MS = 3000
/**
 * A capture that keeps restarting (an invalid frame resets it) or never collects enough
 * samples stops here and explains why, instead of looking stuck.
 */
export const REGISTRATION_LIMIT_MS = 15000

export type RegistrationPhase = 'waiting' | 'countdown' | 'capturing' | 'saving' | 'done' | 'stopped' | 'failed'

const TICK_MS = 100

/**
 * The 「자세 등록」 tab flow (plan 0024): once the face and both shoulders are visible it counts
 * down 3·2·1, captures the posture, saves it on the server (B1, 2026-10-20) and ends by itself.
 * It runs only on this tab and only when there is no registered posture yet or the user asked
 * to register again.
 */
export function usePostureRegistration(camera: CameraController, measuring: boolean) {
  const [armed, setArmed] = useState(() => !camera.baseline && !camera.baselineLoading)
  const [phase, setPhase] = useState<RegistrationPhase>('waiting')
  const [now, setNow] = useState(() => performance.now())
  /** Why the last attempt failed; null for the capture time limit (the headline explains it). */
  const [error, setError] = useState<string | null>(null)
  const countdownStart = useRef<number | null>(null)
  const captureStart = useRef<number | null>(null)
  const sawProgress = useRef(false)
  const latest = useRef(camera)
  latest.current = camera

  // F7: do not register with the shoulders at the bottom edge; the user is asked to sit back.
  const ready = camera.state === 'on' && camera.quality && camera.framing !== 'low' && !measuring
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
        sawProgress.current = false
        setError(null)
        cam.calibrate()
        setPhase('capturing')
      }
      return
    }
    if (phase === 'saving') {
      // Wait for the server: the new baseline, or the reason it was not saved.
      if (cam.registering && !cam.registrationError) return
      if (cam.registrationError) setError(cam.registrationError)
      setPhase(cam.registrationError ? 'failed' : 'done')
      setArmed(false)
      return
    }
    if (phase !== 'capturing') return
    if (cam.registering) {
      setPhase('saving')
      return
    }
    if (cam.registrationError) {
      setError(cam.registrationError)
      setPhase('failed')
      setArmed(false)
      return
    }
    if (cam.progress !== null) sawProgress.current = true
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
  }, [
    armed,
    measuring,
    phase,
    ready,
    now,
    camera.progress,
    camera.calibrationId,
    camera.registering,
    camera.registrationError,
  ])

  const countdownLeft =
    phase === 'countdown' && countdownStart.current !== null
      ? Math.max(1, Math.ceil((REGISTRATION_COUNTDOWN_MS - (now - countdownStart.current)) / 1000))
      : null

  return {
    phase,
    armed,
    countdownLeft,
    error,
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
      setError(null)
      setArmed(true)
      setPhase('waiting')
    },
  }
}
