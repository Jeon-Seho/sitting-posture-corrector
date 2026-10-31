import { useCallback, useEffect, useRef, useState } from 'react'
import { useServerBaseline } from '../baseline/useServerBaseline'
import { FRAMING_BOTTOM, type CameraController } from '../../hooks/useCamera'
import type { Observation, ShoulderState } from '../camera/types'
import type { VisualOptions } from '../../lib/poseVisual'
import { requireSyntheticMode } from './guard'
requireSyntheticMode()

/** `true` for a measurable frame; the app sends coordinates and computes no posture values. */
type Sink = (measurable: boolean, frame?: Observation) => void
const sinks = new Set<Sink>()
let stops = 0
let connected = false

export function emitSyntheticFrame(measurable: boolean, frame?: Observation) {
  if (!connected) throw new Error('The synthetic camera must be connected through the UI.')
  for (const sink of sinks) sink(measurable, frame)
}

export function syntheticCameraStatus() {
  return {
    connected,
    stops
  }
}
/**
 * Explicit test adapter: optional canvas-only preview, no camera permission or detector. Landmarks
 * come only from the synthetic frames; registration runs the app's own capture and B1 save.
 */

export function useCamera(options: { baselineMode?: 'server' | 'local' } = {}): CameraController {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const previewTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const releasePreview = useCallback(() => {
    if (previewTimer.current !== null) clearInterval(previewTimer.current)
    previewTimer.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])
  const lastFrame = useRef(0)
  /** Previous synthetic frame time, for the capture's gap check (real camera: `useCamera`). */
  const previousTime = useRef<number | null>(null)
  const listeners = useRef(new Set<(frame: Observation) => void>())
  const [state, setState] = useState<CameraController['state']>('off')
  const [quality, setQuality] = useState(false)
  const [shoulders, setShoulders] = useState<ShoulderState | null>(null)
  const [framing, setFraming] = useState<'ok' | 'low' | null>(null)
  const {
    baseline, registering, registrationError, baselineLoading, baselineError,
    progress, reloadBaseline, observe: observeBaseline, begin: beginBaseline,
    cancel: cancelCalibration,
  } = useServerBaseline(options.baselineMode !== 'local')
  const [visual, setVisual] = useState<VisualOptions>({
    mode: 'skeleton',
    enabled: true,
    reducedMotion: true,
    startedAt: 0
  })
  const subscribe = useCallback(
    (listener: (frame: Observation) => void) => {
      listeners.current.add(listener)
      return () => {
        listeners.current.delete(listener)
      }
    },
    []
  )
  const stop = useCallback(
    () => {
      releasePreview()
      connected = false
      stops++
      lastFrame.current = 0
      previousTime.current = null
      setState('off')
      setQuality(false)
      setShoulders(null)
      setFraming(null)
      cancelCalibration()
    },
    [releasePreview, cancelCalibration]
  )
  useEffect(
    () => {
      const receive: Sink = (measurable, suppliedFrame) => {
        lastFrame.current = performance.now()
        setQuality(measurable)
        const frame: Observation = suppliedFrame ? { ...suppliedFrame, measurable } : {
          timeMs: performance.now(),
          videoTimeMs: performance.now(),
          measurable,
          landmarks: [],
          worldLandmarks: [],
          inferenceMs: 0,
          delegate: 'CPU',
          width: 640,
          height: 480,
        }
        setShoulders(frame.shoulders ?? null)
        const l = frame.landmarks[11], r = frame.landmarks[12]
        setFraming(frame.shoulders === 'seen' && l && r ? (Math.max(l.y, r.y) > FRAMING_BOTTOM ? 'low' : 'ok') : null)
        for (const listener of listeners.current) listener(frame)
        const gap = previousTime.current === null ? 0 : frame.timeMs - previousTime.current
        previousTime.current = frame.timeMs
        observeBaseline(frame, gap)
      }
      sinks.add(receive)
      return () => {
        sinks.delete(receive)
        connected = false
        releasePreview()
      }
    },
    [releasePreview, observeBaseline]
  )
  const connect = useCallback(
    async () => {
      releasePreview()
      // Only the explicit browser-smoke preview test generates pixels; never use getUserMedia.
      if (new URLSearchParams(location.search).get('preview') === '1') {
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 480
        const context = canvas.getContext('2d')!
        streamRef.current = canvas.captureStream(5)
        const draw = () => {
          context.fillStyle = '#182d38'
          context.fillRect(0, 0, 640, 480)
          context.fillStyle = '#ef9245'
          context.fillRect(240, 100, 160, 240)
          context.fillStyle = '#ffffff'
          context.font = '24px sans-serif'
          context.fillText('SYNTHETIC PREVIEW ONLY', 140, 410)
        }
        draw()
        previewTimer.current = setInterval(draw, 200)
        if (videoRef.current) {
          videoRef.current.srcObject = streamRef.current
          await videoRef.current.play()
        }
      }
      connected = true
      lastFrame.current = performance.now()
      previousTime.current = null
      setState('on')
      setQuality(true)
      if (videoRef.current) {
        Object.defineProperty(
          videoRef.current,
          'videoWidth',
          {
            get: () => 640,
            configurable: true
          }
        )
        Object.defineProperty(
          videoRef.current,
          'videoHeight',
          {
            get: () => 480,
            configurable: true
          }
        )
      }
    },
    [releasePreview]
  )
  const calibrate = () => {
    if (state === 'on' && quality) beginBaseline()
  }
  const setOverlayEnabled = useCallback(
    (enabled: boolean) => {
      setVisual((previous) => previous.enabled === enabled ? previous : {
        ...previous,
        enabled
      })
    },
    []
  )
  return {
    visual,
    setVisualMode: (mode) => setVisual((v) => ({
      ...v,
      mode
    })),
    reassemble: () => setVisual((v) => ({
      ...v,
      startedAt: performance.now()
    })),
    setReducedMotion: (reducedMotion) => setVisual((v) => ({
      ...v,
      reducedMotion
    })),
    setOverlayEnabled,
    metrics: {
      fps: 0,
      inferenceMs: 0,
      delegate: 'CPU'
    },
    trackerDiagnostics: null,
    subscribe,
    videoRef,
    canvasRef,
    streamRef,
    devices: [],
    deviceId: state === 'on' ? 'explicit-synthetic-device' : '',
    mainDeviceId: '',
    mainMissing: false,
    baselineInfo: null,
    trackingFps: null,
    setTrackingFps: () => {},
    tryTrackingFps: () => {},
    chooseMainCamera: () => {},
    refreshDevices: async () => {},
    state,
    error: '',
    quality,
    shoulders,
    framing,
    baseline,
    calibrationId: baseline?.baselineId ?? null,
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
