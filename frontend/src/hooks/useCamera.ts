import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { placement, type Features } from '../../../model/prototype/pose'
import {
  beginCalibration,
  observeCalibration,
  type Calibration,
  type CalibrationSummary,
} from '../../../model/prototype/calibration'
import type { VisualMode, VisualOptions } from '../lib/poseVisual'
import { listVideoDevices, requestCamera, stopCameraTracks } from '../features/camera/devices'
import { createFeatureFilter } from '../lib/skeleton'
import { readTrackingFps, writeTrackingFps } from '../features/camera/trackingRate'
import { CAMERA_ERRORS, cameraPreparationError } from '../features/camera/errors'
import { missingDevice, readMainCamera, writeMainCamera } from '../features/camera/mainCamera'
import { baselineFor, readSavedBaselines, writeSavedBaseline } from '../features/camera/savedBaseline'
import { startPoseFrameLoop } from '../features/camera/frameLoop'
import { loadPoseDetector } from '../features/camera/modelLoader'
import type { CameraMetrics, CameraState, Observation, ShoulderState } from '../features/camera/types'

export type { Observation } from '../features/camera/types'

const PREPARATION_TIMEOUT_MS = 30_000
/** Shoulders lower than this (share of the frame height) are too close to the bottom edge. */
export const FRAMING_BOTTOM = 0.88
const EMPTY_METRICS: CameraMetrics = { fps: 0, inferenceMs: 0, delegate: 'CPU' }

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const detector = useRef<PoseLandmarker | null>(null)
  const generation = useRef(0)
  const stopFrameLoop = useRef<(() => void) | null>(null)
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Smoothed features for local judging; observations keep the raw values (server, CSV). */
  const current = useRef<Features | null>(null)
  const featureFilter = useRef(createFeatureFilter<Features>())
  const lastFrame = useRef(0)
  const calibration = useRef<Calibration | null>(null)
  const listeners = useRef(new Set<(observation: Observation) => void>())

  const [visual, updateVisual] = useState<VisualOptions>(() => ({
    mode: 'skeleton',
    enabled: true,
    reducedMotion:
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    startedAt: 0,
  }))
  const visualRef = useRef(visual)
  const [metrics, setMetrics] = useState<CameraMetrics>(() => ({ ...EMPTY_METRICS }))
  const [state, setState] = useState<CameraState>('off')
  const [error, setError] = useState('')
  const [quality, setQuality] = useState(false)
  /**
   * Framing before registration (FE task F7): `low` when a shoulder sits in the bottom 12% of
   * the frame, where a small lean takes it out of view. Experimental margin, not validated.
   */
  const [framing, setFraming] = useState<'ok' | 'low' | null>(null)
  /** Shoulder tracking of the latest frame (2 s head-only grace, 2026-10-13). */
  const [shoulders, setShoulders] = useState<ShoulderState | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  /** Saved main camera; connect() without an id uses it (2026-10-13). */
  const [mainDeviceId, setMainDeviceId] = useState(readMainCamera)
  /** The saved main camera was not found at the last connect, so the default one was used. */
  const [mainMissing, setMainMissing] = useState(false)
  /** Tracking rate cap; `trial` overrides it during the jitter check without saving. */
  const [trackingFps, setTrackingFpsState] = useState<number | null>(readTrackingFps)
  const fpsCap = useRef<number | null>(trackingFps)
  const fpsTrial = useRef<number | null>(null)
  /**
   * The registered baseline outlives the camera and, since 2026-10-13, the app run: it is
   * saved on this computer with the camera it was taken with. Connecting another camera
   * sets it aside (`baselineOtherCamera`); only a new registration replaces it.
   */
  /** Postures by camera, newest first (plan 0053); the newest is shown until a camera connects. */
  const saved = useRef(readSavedBaselines())
  const newest = saved.current[0] ?? null
  const connectedDevice = useRef('')
  const [baseline, setBaseline] = useState<Features | null>(() => newest?.baseline ?? null)
  const [calibrationId, setCalibrationId] = useState<string | null>(
    () => newest?.calibrationId ?? null,
  )
  const [calibrationSummary, setCalibrationSummary] = useState<CalibrationSummary | null>(
    () => newest?.summary ?? null,
  )
  const [baselineOtherCamera, setBaselineOtherCamera] = useState(false)
  /** When and with which camera the current posture was registered (settings). */
  const [baselineInfo, setBaselineInfo] = useState<{ savedAt: string; deviceId: string } | null>(() =>
    newest ? { savedAt: newest.savedAt, deviceId: newest.deviceId } : null,
  )
  const [progress, setProgress] = useState<number | null>(null)

  const changeVisual = useCallback((patch: Partial<VisualOptions>) => {
    const next = { ...visualRef.current, ...patch }
    visualRef.current = next
    updateVisual(next)
  }, [])
  const setVisualMode = (mode: VisualMode) => changeVisual({ mode, startedAt: performance.now() })
  const reassemble = () => changeVisual({ startedAt: performance.now() })
  const setReducedMotion = (reducedMotion: boolean) => changeVisual({ reducedMotion })
  const setOverlayEnabled = useCallback(
    (enabled: boolean) => changeVisual({ enabled }),
    [changeVisual],
  )
  const subscribe = useCallback((listener: (observation: Observation) => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const clearLoadingTimer = useCallback(() => {
    if (loadingTimer.current !== null) clearTimeout(loadingTimer.current)
    loadingTimer.current = null
  }, [])

  const release = useCallback(() => {
    generation.current++
    stopFrameLoop.current?.()
    stopFrameLoop.current = null
    clearLoadingTimer()
    stopCameraTracks(stream.current)
    stream.current = null
    detector.current?.close()
    detector.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    // The frame loop stops drawing, so remove the last skeleton instead of freezing it.
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    current.current = null
    featureFilter.current.reset()
    lastFrame.current = 0
    calibration.current = null
  }, [clearLoadingTimer])

  const stop = useCallback(() => {
    release()
    setState('off')
    setError('')
    setQuality(false)
    setProgress(null)
  }, [release])
  useEffect(() => () => release(), [release])

  const receiveObservation = useCallback((observation: Observation, observationGap: number) => {
    if (!observation.features) featureFilter.current.reset()
    current.current = observation.features
      ? featureFilter.current.next(observation.features, lastFrame.current ? observation.timeMs - lastFrame.current : 33)
      : null
    lastFrame.current = observation.timeMs
    setQuality(!!observation.features && observation.shoulders !== 'grace')
    setShoulders(observation.shoulders ?? null)
    const l = observation.landmarks[11], r = observation.landmarks[12]
    setFraming(
      observation.shoulders === 'seen' && l && r ? (Math.max(l.y, r.y) > FRAMING_BOTTOM ? 'low' : 'ok') : null,
    )
    for (const listener of listeners.current) listener(observation)

    if (!calibration.current) return
    // A registration needs the real shoulders; a grace frame restarts it like a missing one.
    const own = observation.shoulders === 'grace' ? null : observation.features
    const next = observeCalibration(
      calibration.current,
      own,
      observation.timeMs,
      observationGap,
      own ? placement(observation.landmarks) : null,
    )
    calibration.current = next.draft
    setProgress(next.progress)
    if (next.ready) {
      const id = crypto.randomUUID()
      setBaseline(next.ready)
      setCalibrationSummary(next.summary)
      setCalibrationId(id)
      setBaselineOtherCamera(false)
      const entry = {
        deviceId: connectedDevice.current,
        calibrationId: id,
        baseline: next.ready,
        summary: next.summary,
      }
      saved.current = writeSavedBaseline(entry, saved.current)
      setBaselineInfo({ savedAt: saved.current[0].savedAt, deviceId: entry.deviceId })
      calibration.current = null
      setProgress(null)
    }
  }, [])

  const refreshDevices = useCallback(async () => {
    setDevices(await listVideoDevices())
  }, [])

  // Plugging or unplugging a camera updates the choices in settings.
  useEffect(() => {
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!media?.addEventListener) return
    void refreshDevices()
    const changed = () => void refreshDevices()
    media.addEventListener('devicechange', changed)
    return () => media.removeEventListener('devicechange', changed)
  }, [refreshDevices])

  const connect = useCallback(
    /** An explicit `selectedId` also becomes the main camera. */
    async (selectedId?: string) => {
      if (selectedId) {
        writeMainCamera(selectedId)
        setMainDeviceId(selectedId)
      }
      const wanted = selectedId || readMainCamera()
      release()
      const token = generation.current
      const isCurrent = () => generation.current === token
      setMetrics({ ...EMPTY_METRICS })
      setState('loading')
      setQuality(false)
      setError('')
      setProgress(null)

      loadingTimer.current = setTimeout(() => {
        if (!isCurrent()) return
        release()
        setState('error')
        setQuality(false)
        setProgress(null)
        setError(CAMERA_ERRORS.preparationTimeout)
      }, PREPARATION_TIMEOUT_MS)

      try {
        let incoming: MediaStream
        try {
          incoming = await requestCamera(wanted || undefined)
          setMainMissing(false)
        } catch (cause) {
          if (!wanted || !missingDevice(cause)) throw cause
          // The saved main camera is unplugged: keep the choice and use the default camera.
          incoming = await requestCamera()
          setMainMissing(true)
        }
        if (!isCurrent()) {
          stopCameraTracks(incoming)
          return
        }
        stream.current = incoming
        const track = incoming.getVideoTracks()[0]
        const connectedId = track.getSettings().deviceId ?? ''
        connectedDevice.current = connectedId
        setDeviceId(connectedId)
        // Each camera has its own posture (plan 0053): use this camera's, or none.
        const stored = baselineFor(saved.current, connectedId)
        setBaselineOtherCamera(!stored && saved.current.length > 0)
        if (stored) {
          setBaseline(stored.baseline)
          setCalibrationId(stored.calibrationId)
          setCalibrationSummary(stored.summary)
          setBaselineInfo({ savedAt: stored.savedAt, deviceId: stored.deviceId })
        } else if (saved.current.length > 0) {
          setBaseline(null)
          setCalibrationId(null)
          setCalibrationSummary(null)
        }
        setDevices(await listVideoDevices())
        if (!isCurrent()) return

        track.onended = () => {
          if (!isCurrent()) return
          release()
          setState('error')
          setQuality(false)
          setProgress(null)
          setError(CAMERA_ERRORS.disconnected)
        }

        const loaded = await loadPoseDetector(isCurrent)
        if (!loaded) return
        if (!isCurrent()) {
          loaded.detector.close()
          return
        }
        detector.current = loaded.detector
        const video = videoRef.current
        if (!video) throw new Error(CAMERA_ERRORS.videoUnavailable)
        video.srcObject = incoming
        await video.play()
        if (!isCurrent()) return

        clearLoadingTimer()
        setState('on')
        visualRef.current = { ...visualRef.current, startedAt: performance.now() }
        stopFrameLoop.current = startPoseFrameLoop({
          video,
          detector: loaded.detector,
          delegate: loaded.delegate,
          isCurrent,
          getMaxFps: () => fpsTrial.current ?? fpsCap.current,
          getCanvas: () => canvasRef.current,
          getVisual: () => visualRef.current,
          onPoseStarted: () => {
            visualRef.current = { ...visualRef.current, startedAt: performance.now() }
          },
          onObservation: receiveObservation,
          onFrameUnavailable: () => {
            current.current = null
            setQuality(false)
            if (calibration.current) {
              calibration.current = beginCalibration()
              setProgress(0)
            }
          },
          onMetrics: setMetrics,
          onTrackingError: () => {
            release()
            setState('error')
            setQuality(false)
            setProgress(null)
            setError(CAMERA_ERRORS.trackingFailed)
          },
        })
      } catch (cause) {
        if (!isCurrent()) return
        release()
        setState('error')
        setQuality(false)
        setError(cameraPreparationError(cause))
      }
    },
    [clearLoadingTimer, receiveObservation, release],
  )

  /** Saves the tracking rate cap (`null` = device default) and applies it at once. */
  const setTrackingFps = (fps: number | null) => {
    writeTrackingFps(fps)
    fpsCap.current = fps
    setTrackingFpsState(fps)
  }
  /** Jitter check only: try a rate without saving it; `null` returns to the saved one. */
  const tryTrackingFps = (fps: number | null) => {
    fpsTrial.current = fps
  }

  /** Saves the main camera and switches to it when another camera is on. */
  const chooseMainCamera = (id: string) => {
    writeMainCamera(id)
    setMainDeviceId(id)
    if (id && (state === 'on' || state === 'loading') && id !== deviceId) void connect(id)
  }

  const calibrate = () => {
    if (state !== 'on' || !quality || calibration.current) return
    setProgress(0)
    calibration.current = beginCalibration()
  }
  const cancelCalibration = () => {
    calibration.current = null
    setProgress(null)
  }

  return {
    visual,
    setVisualMode,
    reassemble,
    setReducedMotion,
    setOverlayEnabled,
    metrics,
    subscribe,
    videoRef,
    canvasRef,
    streamRef: stream,
    devices,
    deviceId,
    mainDeviceId,
    mainMissing,
    baselineOtherCamera,
    baselineInfo,
    trackingFps,
    setTrackingFps,
    tryTrackingFps,
    chooseMainCamera,
    refreshDevices,
    state,
    error,
    quality,
    shoulders,
    framing,
    baseline,
    calibrationId,
    calibrationSummary,
    progress,
    current,
    lastFrame,
    connect,
    stop,
    calibrate,
    cancelCalibration,
  }
}

export type CameraController = ReturnType<typeof useCamera>
