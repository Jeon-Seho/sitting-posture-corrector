import { useEffect, useRef } from 'react'
import type { CameraController } from '../../hooks/useCamera'

/** Face and shoulders must stay visible this long before calibration starts on its own. */
export const AUTO_CALIBRATE_DELAY_MS = 800

/**
 * Setup without clicks (user decision 2026-10-06): once the face and both shoulders are
 * visible, calibration starts by itself; when a calibration finished on this screen, the
 * measurement starts. Cancelling turns the automatic start off until the user starts
 * calibration again, and an older baseline never starts a measurement by itself.
 */
export function useAutoBaseline(camera: CameraController, onStart: () => void) {
  const latest = useRef({ camera, onStart })
  latest.current = { camera, onStart }
  const declined = useRef(false)
  const calibratedHere = useRef(false)
  const on = camera.state === 'on'
  const calibrating = camera.progress !== null

  useEffect(() => {
    if (!on || !camera.quality || camera.baseline || calibrating || declined.current) return
    const timer = setTimeout(() => latest.current.camera.calibrate(), AUTO_CALIBRATE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [on, camera.quality, camera.baseline, calibrating])

  useEffect(() => {
    if (calibrating) calibratedHere.current = true
  }, [calibrating])

  useEffect(() => {
    if (!calibratedHere.current || calibrating || !on || !camera.quality || !camera.baseline) return
    calibratedHere.current = false
    latest.current.onStart()
  }, [calibrating, on, camera.quality, camera.baseline])

  return {
    /** Manual start also re-enables the automatic flow. */
    calibrate() {
      declined.current = false
      camera.calibrate()
    },
    cancel() {
      declined.current = true
      calibratedHere.current = false
      camera.cancelCalibration()
    },
  }
}
