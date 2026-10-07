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
import { CAMERA_ERRORS, cameraPreparationError } from '../features/camera/errors'
import { startPoseFrameLoop } from '../features/camera/frameLoop'
import { loadPoseDetector } from '../features/camera/modelLoader'
import type { CameraMetrics, CameraState, Observation } from '../features/camera/types'

export type { Observation } from '../features/camera/types'

const PREPARATION_TIMEOUT_MS = 30_000
const EMPTY_METRICS: CameraMetrics = { fps: 0, inferenceMs: 0, delegate: 'CPU' }

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const detector = useRef<PoseLandmarker | null>(null)
  const generation = useRef(0)
  const stopFrameLoop = useRef<(() => void) | null>(null)
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef<Features | null>(null)
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
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [baseline, setBaseline] = useState<Features | null>(null)
  const [calibrationId, setCalibrationId] = useState<string | null>(null)
  const [calibrationSummary, setCalibrationSummary] = useState<CalibrationSummary | null>(null)
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
    lastFrame.current = 0
    calibration.current = null
  }, [clearLoadingTimer])

  const stop = useCallback(() => {
    release()
    setState('off')
    setError('')
    setQuality(false)
    setBaseline(null)
    setCalibrationId(null)
    setCalibrationSummary(null)
    setProgress(null)
  }, [release])
  useEffect(() => () => release(), [release])

  const receiveObservation = useCallback((observation: Observation, observationGap: number) => {
    current.current = observation.features
    lastFrame.current = observation.timeMs
    setQuality(!!observation.features)
    for (const listener of listeners.current) listener(observation)

    if (!calibration.current) return
    const next = observeCalibration(
      calibration.current,
      observation.features,
      observation.timeMs,
      observationGap,
      observation.features ? placement(observation.landmarks) : null,
    )
    calibration.current = next.draft
    setProgress(next.progress)
    if (next.ready) {
      setBaseline(next.ready)
      setCalibrationSummary(next.summary)
      setCalibrationId(crypto.randomUUID())
      calibration.current = null
      setProgress(null)
    }
  }, [])

  const connect = useCallback(
    async (selectedId?: string) => {
      release()
      const token = generation.current
      const isCurrent = () => generation.current === token
      setMetrics({ ...EMPTY_METRICS })
      setState('loading')
      setQuality(false)
      setError('')
      setBaseline(null)
      setCalibrationId(null)
      setCalibrationSummary(null)
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
        const incoming = await requestCamera(selectedId)
        if (!isCurrent()) {
          stopCameraTracks(incoming)
          return
        }
        stream.current = incoming
        const track = incoming.getVideoTracks()[0]
        setDeviceId(track.getSettings().deviceId ?? '')
        setDevices(await listVideoDevices())
        if (!isCurrent()) return

        track.onended = () => {
          if (!isCurrent()) return
          release()
          setState('error')
          setQuality(false)
          setBaseline(null)
          setCalibrationId(null)
          setCalibrationSummary(null)
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
            setBaseline(null)
            setCalibrationId(null)
            setCalibrationSummary(null)
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
    state,
    error,
    quality,
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

export type CameraController = ReturnType<typeof useCamera> & {face?:import('../features/face-lab/serviceInput').FaceServiceController}
