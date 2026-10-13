import { useEffect, useRef, useState } from 'react'

/** How long the face and both shoulders must stay in view before measuring starts by itself. */
export const AUTO_START_MS = 2500
const TICK_MS = 100

/**
 * 「카메라 켜기」 with a registered posture (2026-10-13, from the test branch's automatic start):
 * once the person stays in view for 2.5 s, start measuring. Only after the camera was turned
 * on here; leaving the view resets the wait, 「취소」 stops it until the camera is turned on again.
 */
export function useAutoStart({
  cameraOn,
  ready,
  enabled,
  onStart,
}: {
  cameraOn: boolean
  /** Registered posture, person in view, nothing else running. */
  ready: boolean
  /** Off while registering, measuring or in the settings re-registration. */
  enabled: boolean
  onStart: () => void
}) {
  const [armed, setArmed] = useState(false)
  const [since, setSince] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const wasOn = useRef(cameraOn)
  const latest = useRef(onStart)
  latest.current = onStart

  // Arm when the camera turns on on this screen (not when the screen opens with it already on).
  useEffect(() => {
    if (cameraOn && !wasOn.current) setArmed(true)
    if (!cameraOn) setArmed(false)
    wasOn.current = cameraOn
  }, [cameraOn])

  const waiting = armed && enabled && ready
  useEffect(() => {
    if (!waiting) {
      setSince(null)
      return
    }
    const start = performance.now()
    setSince(start)
    setNow(start)
    const timer = setInterval(() => {
      const t = performance.now()
      setNow(t)
      if (t - start >= AUTO_START_MS) {
        clearInterval(timer)
        setArmed(false)
        latest.current()
      }
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [waiting])

  return {
    /** Seconds left (3, 2, 1) while waiting; null when not waiting. */
    left: since === null ? null : Math.max(1, Math.ceil((AUTO_START_MS - (now - since)) / 1000)),
    progress: since === null ? null : Math.min(1, (now - since) / AUTO_START_MS),
    cancel: () => setArmed(false),
  }
}
