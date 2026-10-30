import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseDetector } from '../features/camera/cpuWorker'
import type { PoseTrackerDiagnostics, PoseTrackerOptions } from '../features/mediapipe/types'
import modelAsset from '../../model-asset.json'
import type { VisualMode, VisualOptions } from '../lib/poseVisual'
import { listVideoDevices, requestCamera, stopCameraTracks } from '../features/camera/devices'
import { readTrackingFps, writeTrackingFps } from '../features/camera/trackingRate'
import { CAMERA_ERRORS, cameraPreparationError } from '../features/camera/errors'
import { missingDevice, readMainCamera, writeMainCamera } from '../features/camera/mainCamera'
import { useServerBaseline } from '../features/baseline/useServerBaseline'
import { startPoseFrameLoop } from '../features/camera/frameLoop'
import { loadPoseDetector } from '../features/camera/modelLoader'
import type { CameraMetrics, CameraState, Observation, ShoulderState } from '../features/camera/types'

export type { Observation } from '../features/camera/types'
export type CameraRuntimeOptions = PoseTrackerOptions & { pacing?: 'legacy' | 'responsive' }

const PREPARATION_TIMEOUT_MS = 30_000
/** Shoulders lower than this (share of the frame height) are too close to the bottom edge. */
export const FRAMING_BOTTOM = 0.88
const EMPTY_METRICS: CameraMetrics = { fps: 0, inferenceMs: 0, delegate: 'CPU' }

export function useCamera(options: { baselineMode?: 'server' | 'local' } = {}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const detector = useRef<PoseDetector | null>(null)
  const generation = useRef(0)
  const stopFrameLoop = useRef<(() => void) | null>(null)
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Smoothed features for local judging; observations keep the raw values (server, CSV). */
  const lastFrame = useRef(0)
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
  const [trackerDiagnostics, setTrackerDiagnostics] = useState<PoseTrackerDiagnostics | null>(null)
  const [state, setState] = useState<CameraState>('off')
  const [error, setError] = useState('')
  const [quality, setQuality] = useState(false)
  /**
   * Framing before registration (FE task F7): `low` when a shoulder sits in the bottom 12% of
   * the frame, where a small lean takes it out of view. Experimental margin, not validated.
   */
  const [framing, setFraming] = useState<'ok' | 'low' | null>(null)
  /** Shoulder tracking of the latest frame. */
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
  const {
    baseline: serverBaseline, registering, registrationError, baselineLoading, baselineError,
    progress, reloadBaseline, observe: observeBaseline, begin: beginBaseline,
    clearCapture, interruptCapture, cancel: cancelCalibration, resetProgress,
  } = useServerBaseline(options.baselineMode !== 'local')

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
    lastFrame.current = 0
    clearCapture()
  }, [clearLoadingTimer, clearCapture])

  const stop = useCallback(() => {
    release()
    setState('off')
    setError('')
    setQuality(false)
    resetProgress()
  }, [release, resetProgress])
  useEffect(() => () => release(), [release])

  const receiveObservation = useCallback((observation: Observation, observationGap: number) => {
    lastFrame.current = observation.timeMs
    setQuality(observation.measurable === true)
    setShoulders(observation.shoulders ?? null)
    const l = observation.landmarks[11], r = observation.landmarks[12]
    setFraming(
      observation.shoulders === 'seen' && l && r ? (Math.max(l.y, r.y) > FRAMING_BOTTOM ? 'low' : 'ok') : null,
    )
    for (const listener of listeners.current) listener(observation)

    observeBaseline(observation, observationGap)
  }, [observeBaseline])

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
      setTrackerDiagnostics(null)
      setState('loading')
      setQuality(false)
      setError('')
      resetProgress()

      loadingTimer.current = setTimeout(() => {
        if (!isCurrent()) return
        release()
        setState('error')
        setQuality(false)
        resetProgress()
        setError(CAMERA_ERRORS.preparationTimeout)
      }, PREPARATION_TIMEOUT_MS)

      try {
        let incoming: MediaStream
        try {
          incoming = await requestCamera(wanted || undefined)
          setMainMissing(false)
        } catch (cause) {
          console.error('[hooks/useCamera.ts:connect] Operation failed', cause)
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
          resetProgress()
          setError(CAMERA_ERRORS.disconnected)
        }

        const modelStarted = performance.now()
        let loaded = await loadPoseDetector(isCurrent)
        if (!loaded) return
        if (!isCurrent()) {
          loaded.detector.close()
          return
        }
        detector.current = loaded.detector
        setTrackerDiagnostics({ variant: 'heavy', modelId: modelAsset.modelId, requestedDelegate: 'auto',
          actualDelegate: loaded.delegate, fallbackReason: loaded.delegate === 'CPU' ? 'gpu_initialization_failed' : null,
          initializationMs: performance.now() - modelStarted })
        const video = videoRef.current
        if (!video) throw new Error(CAMERA_ERRORS.videoUnavailable)
        video.srcObject = incoming
        await video.play()
        if (!isCurrent()) return

        clearLoadingTimer()
        setState('on')
        visualRef.current = { ...visualRef.current, startedAt: performance.now() }
        const startTracking = () => {
          if (!loaded || !isCurrent()) return
          const active = loaded
          setMetrics({ ...EMPTY_METRICS, delegate: active.delegate })
          stopFrameLoop.current = startPoseFrameLoop({
            video,
            detector: active.detector,
            delegate: active.delegate,
            isCurrent,
            getMaxFps: () => fpsTrial.current ?? fpsCap.current,
            getCanvas: () => canvasRef.current,
            getVisual: () => visualRef.current,
            onPoseStarted: () => {
              visualRef.current = { ...visualRef.current, startedAt: performance.now() }
            },
            onObservation: receiveObservation,
            onFrameUnavailable: () => {
              setQuality(false)
              interruptCapture()
            },
            onMetrics: setMetrics,
            onTrackingError: (inferenceFailed) => {
              if (!isCurrent()) return
              if (active.delegate === 'GPU' && inferenceFailed) {
                stopFrameLoop.current?.()
                stopFrameLoop.current = null
                active.detector.close()
                detector.current = null
                setQuality(false)
                lastFrame.current = 0
                interruptCapture()
                setState('loading')
                loadingTimer.current = setTimeout(() => {
                  if (!isCurrent()) return
                  release()
                  setState('error')
                  resetProgress()
                  setError(CAMERA_ERRORS.preparationTimeout)
                }, PREPARATION_TIMEOUT_MS)
                void loadPoseDetector(isCurrent, 'CPU').then((cpu) => {
                  if (!cpu || !isCurrent()) return
                  loaded = cpu
                  detector.current = cpu.detector
                  setTrackerDiagnostics(previous => previous ? { ...previous, actualDelegate: 'CPU', fallbackReason: 'gpu_inference_failed' } : previous)
                  clearLoadingTimer()
                  setState('on')
                  startTracking()
                }).catch((cause: unknown) => {
                  console.error('[camera] CPU tracking recovery failed', cause)
                  if (!isCurrent()) return
                  release()
                  setState('error')
                  resetProgress()
                  setError(CAMERA_ERRORS.trackingFailed)
                })
                return
              }
              release()
              setState('error')
              setQuality(false)
              resetProgress()
              setError(CAMERA_ERRORS.trackingFailed)
            },
          })
        }
        startTracking()
      } catch (cause) {
        console.error('[hooks/useCamera.ts:connect] Operation failed', cause)
        if (!isCurrent()) return
        release()
        setState('error')
        setQuality(false)
        setError(cameraPreparationError(cause))
      }
    },
    [clearLoadingTimer, interruptCapture, receiveObservation, release, resetProgress],
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
    if (state === 'on' && quality) beginBaseline()
  }

  return {
    visual,
    setVisualMode,
    reassemble,
    setReducedMotion,
    setOverlayEnabled,
    metrics,
    trackerDiagnostics,
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
    /** The registered posture from the server (B2·B1), or null. */
    baseline: serverBaseline,
    /** The server's `baseline_id` (S1 `baseline_id`). */
    calibrationId: serverBaseline?.baselineId ?? null,
    progress,
    registering,
    registrationError,
    baselineLoading,
    baselineError,
    reloadBaseline,
    lastFrame,
    connect,
    stop,
    calibrate,
    cancelCalibration,
  }
}

export type CameraController = ReturnType<typeof useCamera>
