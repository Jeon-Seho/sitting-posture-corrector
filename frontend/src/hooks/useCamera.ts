import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { features, type Features } from '../../../model/prototype/pose'
import type { CalibrationSummary } from '../../../model/prototype/calibration'
import type { VisualMode, VisualOptions } from '../lib/poseVisual'
import { listVideoDevices, requestCamera, stopCameraTracks } from '../features/camera/devices'
import { createFeatureFilter } from '../lib/skeleton'
import { readTrackingFps, writeTrackingFps } from '../features/camera/trackingRate'
import { CAMERA_ERRORS, cameraPreparationError } from '../features/camera/errors'
import { missingDevice, readMainCamera, writeMainCamera } from '../features/camera/mainCamera'
import {
  baselinePoints,
  beginCapture,
  observeCapture,
  type LandmarkCapture,
} from '../features/baseline/landmarkCapture'
import {
  BaselineRequestError,
  fetchCurrentBaseline,
  registerBaseline,
  type ServerBaseline,
} from '../features/baseline/client'
import { getServerAuth, subscribeServerAuth } from '../features/platform/serverAuth'
import { startPoseFrameLoop } from '../features/camera/frameLoop'
import { loadPoseDetector } from '../features/camera/modelLoader'
import type { CameraMetrics, CameraState, Observation, ShoulderState } from '../features/camera/types'

export type { Observation } from '../features/camera/types'

const PREPARATION_TIMEOUT_MS = 30_000
/** Shoulders lower than this (share of the frame height) are too close to the bottom edge. */
export const FRAMING_BOTTOM = 0.88
const EMPTY_METRICS: CameraMetrics = { fps: 0, inferenceMs: 0, delegate: 'CPU' }
/** The camera is fixed at 640×480 (DB V2.3 `CAPTURE_RESOLUTION`). */
const FRAME_WIDTH = 640
const FRAME_HEIGHT = 480
const OUT_OF_FRAME = '얼굴과 양쪽 어깨가 화면 안에 들어오게 앉은 뒤 다시 등록해 주세요.'

/**
 * `Features` of the server baseline for code that still judges or collects locally (session
 * screen, collection). F5 removes those and this bridge with them.
 */
const baselineFeatures = (saved: ServerBaseline | null): Features | null =>
  saved ? features(baselinePoints(saved.landmarks), FRAME_WIDTH, FRAME_HEIGHT) : null

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
  const capture = useRef<LandmarkCapture | null>(null)
  const saving = useRef(false)
  const mounted = useRef(true)
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
   * The registered posture lives on the server (B1·B2, 2026-10-20 team meeting); this PC keeps
   * no copy. One posture serves every camera (2026-10-16, plan 0053): switching cameras keeps
   * it, and only a new registration (「다시 등록」) replaces it.
   */
  const [serverBaseline, setServerBaseline] = useState<ServerBaseline | null>(null)
  const [baseline, setBaseline] = useState<Features | null>(null)
  /** Being sent to B1 after a finished capture. */
  const [registering, setRegistering] = useState(false)
  /** Why the last registration was not saved (out of frame, signed out, server error). */
  const [registrationError, setRegistrationError] = useState<string | null>(null)
  /** B2 has not answered yet: do not ask to register a posture the server may already have. */
  const [baselineLoading, setBaselineLoading] = useState(() => !!getServerAuth())
  const [progress, setProgress] = useState<number | null>(null)

  const applyBaseline = useCallback((saved: ServerBaseline | null) => {
    setServerBaseline(saved)
    setBaseline(baselineFeatures(saved))
  }, [])

  /** B2: the newest registered posture of the signed-in account (none when signed out). */
  const reloadBaseline = useCallback(async () => {
    if (!getServerAuth()) {
      applyBaseline(null)
      setBaselineLoading(false)
      return
    }
    setBaselineLoading(true)
    try {
      const saved = await fetchCurrentBaseline()
      if (mounted.current) applyBaseline(saved)
    } catch {
      /* Keep what is shown; the next registration or sign-in tries again. */
    } finally {
      if (mounted.current) setBaselineLoading(false)
    }
  }, [applyBaseline])

  useEffect(() => {
    mounted.current = true
    void reloadBaseline()
    const unsubscribe = subscribeServerAuth(() => void reloadBaseline())
    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [reloadBaseline])

  const save = useCallback(
    (captured: Parameters<typeof registerBaseline>[0]) => {
      saving.current = true
      setRegistering(true)
      registerBaseline(captured, new Date().toISOString())
        .then((saved) => {
          if (mounted.current) applyBaseline(saved)
        })
        .catch((cause: unknown) => {
          if (!mounted.current) return
          setRegistrationError(
            cause instanceof BaselineRequestError ? cause.message : '서버에 자세를 저장하지 못했어요. 다시 등록해 주세요.',
          )
        })
        .finally(() => {
          saving.current = false
          if (mounted.current) setRegistering(false)
        })
    },
    [applyBaseline],
  )

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
    capture.current = null
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

    if (!capture.current) return
    // A registration needs the real shoulders and a measurable frame; a grace frame restarts it
    // like a missing one.
    const usable = observation.shoulders !== 'grace' && !!observation.features
    const next = observeCapture(
      capture.current,
      usable ? observation.landmarks : null,
      observation.timeMs,
      observationGap,
    )
    capture.current = next.capture
    setProgress(next.progress)
    if (next.outOfFrame) {
      capture.current = null
      setProgress(null)
      setRegistrationError(OUT_OF_FRAME)
    } else if (next.ready) {
      capture.current = null
      setProgress(null)
      save(next.ready)
    }
  }, [save])

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
        setDeviceId(connectedId)
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
            if (capture.current) {
              capture.current = beginCapture()
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
    if (state !== 'on' || !quality || capture.current || saving.current) return
    setRegistrationError(null)
    setProgress(0)
    capture.current = beginCapture()
  }
  /** Stops an unfinished capture; a capture already being saved still completes. */
  const cancelCalibration = () => {
    capture.current = null
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
    /** When the current posture was registered (settings); the server keeps no camera. */
    baselineInfo: serverBaseline ? { savedAt: serverBaseline.registeredAt, deviceId: '' } : null,
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
    /** The server's `baseline_id` (S1 `baseline_id`). */
    calibrationId: serverBaseline?.baselineId ?? null,
    /** DB V1.1 aggregates, no longer produced (removed with the old server setup, F15). */
    calibrationSummary: null as CalibrationSummary | null,
    progress,
    registering,
    registrationError,
    baselineLoading,
    reloadBaseline,
    current,
    lastFrame,
    connect,
    stop,
    calibrate,
    cancelCalibration,
  }
}

export type CameraController = ReturnType<typeof useCamera>
