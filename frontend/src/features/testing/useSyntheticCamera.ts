import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServerBaseline } from '../baseline/client'
import { BASELINE_JOINT_NAMES, type BaselineLandmarks } from '../baseline/landmarkCapture'
import type { CameraController } from '../../hooks/useCamera'
import type { Observation } from '../camera/types'
import type { VisualOptions } from '../../lib/poseVisual'
import { requireSyntheticMode } from './guard'
requireSyntheticMode()

/** Explicitly synthetic registered posture (B1·B2 shape). */
export const SYNTHETIC_BASELINE: ServerBaseline = {
  baselineId: '22222222-2222-4222-8222-222222222222',
  registeredAt: '2026-10-21T08:00:00.000Z',
  landmarks: Object.fromEntries(BASELINE_JOINT_NAMES.map((n) => [n, { x: 0.5, y: 0.4 }])) as BaselineLandmarks,
}

/** `true` for a measurable frame; the app sends coordinates and computes no posture values. */
type Sink = (measurable: boolean) => void
const sinks = new Set<Sink>()
let stops = 0
let connected = false

export function emitSyntheticFrame(measurable: boolean) {
  if (!connected) throw new Error('The synthetic camera must be connected through the UI.')
  for (const sink of sinks) sink(measurable)
}

export function syntheticCameraStatus() {
  return {
    connected,
    stops
  }
}
/** Explicit test adapter: optional canvas-only preview, no camera permission/detector/landmark data. */

export function useCamera(): CameraController {
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
  const listeners = useRef(new Set<(frame: Observation) => void>())
  const [state, setState] = useState<CameraController['state']>('off')
  const [quality, setQuality] = useState(false)
  const [baseline, setBaseline] = useState<ServerBaseline | null>(null)
  const [calibrationId, setCalibrationId] = useState<string | null>(null)
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
      setState('off')
      setQuality(false)
      setBaseline(null)
      setCalibrationId(null)
    },
    [releasePreview]
  )
  useEffect(
    () => {
      const receive: Sink = (measurable) => {
        lastFrame.current = performance.now()
        setQuality(measurable)
        const frame: Observation = {
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
        for (const listener of listeners.current) listener(frame)
      }
      sinks.add(receive)
      return () => {
        sinks.delete(receive)
        connected = false
        releasePreview()
      }
    },
    [releasePreview]
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
      setState('on')
      setQuality(true)
      setBaseline(null)
      setCalibrationId(null)
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
    if (state !== 'on' || !quality) return
    setBaseline({ ...SYNTHETIC_BASELINE })
    setCalibrationId(SYNTHETIC_BASELINE.baselineId)
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
    shoulders: null,
    framing: null,
    baseline,
    calibrationId,
    progress: null,
    registering: false,
    registrationError: null,
    baselineLoading: false,
    baselineError: null,
    reloadBaseline: async () => {},
    lastFrame,
    connect,
    stop,
    calibrate,
    cancelCalibration: () => { },
  }
}
