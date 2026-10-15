import { useEffect, useRef, useState } from 'react'
import type { CameraController } from '../../../hooks/useCamera'
import { startFaceClient, type FaceSample, type FaceStatus } from './client'
import { FaceTrialAccumulator, type FaceTrial } from './comparison'

export type FaceDisplayMode = 'face' | 'pose' | 'both'
export interface FaceTrackingController {
  enabled: boolean; setEnabled: (value: boolean) => void
  mode: FaceDisplayMode; setMode: (value: FaceDisplayMode) => void
  active: boolean; status: FaceStatus | 'off'; message: string; delegate: string | null
  sample: FaceSample | null; glasses: boolean; setGlasses: (value: boolean) => void
  trialProgress: number | null; trials: FaceTrial[]; startTrial: () => void
}

export function useFaceTracking(camera: CameraController, active: boolean): FaceTrackingController {
  const [enabled, setEnabled] = useState(true)
  const [mode, setMode] = useState<FaceDisplayMode>('face')
  const [status, setStatus] = useState<FaceStatus | 'off'>('off')
  const [message, setMessage] = useState('')
  const [delegate, setDelegate] = useState<string | null>(null)
  const [sample, setSample] = useState<FaceSample | null>(null)
  const [glasses, setGlasses] = useState(true)
  const [trialProgress, setTrialProgress] = useState<number | null>(null)
  const [trials, setTrials] = useState<FaceTrial[]>([])
  const trial = useRef<FaceTrialAccumulator | null>(null)
  const trialId = useRef(0)
  const running = active && enabled && camera.state === 'on'
  useEffect(() => {
    if (!running || !camera.videoRef.current) { setSample(null); setStatus('off'); return }
    if (typeof Worker === 'undefined' || typeof createImageBitmap !== 'function') {
      setStatus('error'); setMessage('이 환경에서는 얼굴 Worker를 지원하지 않습니다.'); return
    }
    setStatus('loading'); setMessage('얼굴 전용 모델을 준비하고 있어요.'); setSample(null); setDelegate(null)
    let current = true
    const finishTrial = () => {
      if (!trial.current) return
      const result = trial.current.finish(performance.now())
      trial.current = null; setTrialProgress(null); setTrials(previous => [...previous, result].slice(-6))
    }
    const client = startFaceClient({ video: camera.videoRef.current, origin: location.origin,
      worker: () => new Worker('/mediapipe/face-worker.js'),
      bitmap: video => createImageBitmap(video),
      onStatus: (next, detail = '', device) => { if (current) { setStatus(next); setMessage(detail); if (device) setDelegate(device) } },
      onExpired: () => { if (current) setSample(null) },
      onSample: next => {
        if (!current) return
        setSample(next)
        if (trial.current) {
          if (performance.now() - trial.current.startedAt < 10000) trial.current.add(next.frame, next.difference, next.inferenceMs, next.roundTripMs, next.delegate)
          else finishTrial()
        }
      },
    })
    const unsubscribe = camera.subscribe(observation => client.offer(observation))
    const timer = setInterval(() => {
      if (!trial.current) return
      const progress = Math.min(1, (performance.now() - trial.current.startedAt) / 10000)
      setTrialProgress(progress)
      if (progress === 1) finishTrial()
    }, 100)
    return () => { current = false; unsubscribe(); client.stop(); clearInterval(timer); finishTrial() }
  }, [running, camera.subscribe, camera.videoRef])
  return { enabled, setEnabled, mode, setMode, active: running, status: running ? status : 'off', message, delegate,
    sample: running ? sample : null, glasses, setGlasses, trialProgress, trials,
    startTrial: () => { if (!running || status !== 'ready' || trial.current) return; trial.current = new FaceTrialAccumulator(++trialId.current, glasses, performance.now()); setTrialProgress(0) },
  }
}
