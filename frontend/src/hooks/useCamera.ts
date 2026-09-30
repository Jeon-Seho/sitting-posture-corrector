import { useCallback, useEffect, useRef, useState } from 'react';
import { drawPose, type VisualMode, type VisualOptions } from '../lib/poseVisual';
import { smoothPoints, inferenceInterval } from '../lib/skeleton';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import modelAsset from '../../model-asset.json';
import { features, type Features, type Landmark } from '../../../model/prototype/pose';
import { beginCalibration, observeCalibration, type Calibration } from '../../../model/prototype/calibration';

export type Observation = { timeMs: number; videoTimeMs: number; features: Features | null;
  landmarks: Landmark[]; worldLandmarks: Landmark[];
  inferenceMs: number; delegate: 'GPU' | 'CPU'; width: number; height: number };

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null), detector = useRef<PoseLandmarker | null>(null);
  const generation = useRef(0), raf = useRef<ReturnType<typeof setTimeout> | null>(null), current = useRef<Features | null>(null);
  const lastFrame = useRef(0);
  const [visual, updateVisual] = useState<VisualOptions>(() => ({ mode: 'skeleton', enabled: true,
    reducedMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, startedAt: 0 }));
  const visualRef = useRef(visual);
  const changeVisual = useCallback((patch: Partial<VisualOptions>) => {
    const next = { ...visualRef.current, ...patch }; visualRef.current = next; updateVisual(next);
  }, []);
  const setVisualMode = (mode: VisualMode) => changeVisual({ mode, startedAt: performance.now() });
  const reassemble = () => changeVisual({ startedAt: performance.now() });
  const setReducedMotion = (reducedMotion: boolean) => changeVisual({ reducedMotion });
  const setOverlayEnabled = useCallback((enabled: boolean) => changeVisual({ enabled }), [changeVisual]);
  const listeners = useRef(new Set<(observation: Observation) => void>());
  const subscribe = useCallback((listener: (observation: Observation) => void) => {
    listeners.current.add(listener); return () => { listeners.current.delete(listener); };
  }, []);
  const [metrics, setMetrics] = useState({ fps: 0, inferenceMs: 0, delegate: 'CPU' as 'GPU' | 'CPU' });
  const calibration = useRef<Calibration | null>(null);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<'off' | 'loading' | 'on' | 'error'>('off');
  const [error, setError] = useState('');
  const [quality, setQuality] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [baseline, setBaseline] = useState<Features | null>(null);
  const [calibrationId, setCalibrationId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const release = useCallback(() => {
    generation.current++; if (raf.current !== null) clearTimeout(raf.current);
    if (loadingTimer.current !== null) clearTimeout(loadingTimer.current); loadingTimer.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    detector.current?.close(); detector.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    current.current = null; lastFrame.current = 0; calibration.current = null;
  }, []);
  const stop = useCallback(() => {
    release(); setState('off'); setError(''); setQuality(false); setBaseline(null); setCalibrationId(null); setProgress(null);
  }, [release]);
  useEffect(() => () => release(), [release]);

  const connect = useCallback(async (selectedId?: string) => {
    release(); const token = generation.current;
    setMetrics({ fps: 0, inferenceMs: 0, delegate: 'CPU' });
    setState('loading'); setQuality(false); setError(''); setBaseline(null); setCalibrationId(null); setProgress(null);
    loadingTimer.current = setTimeout(() => {
      if (generation.current !== token) return;
      release(); setState('error'); setQuality(false); setProgress(null);
      setError('카메라 준비가 오래 걸립니다. 권한 창과 연결을 확인한 뒤 다시 시도해 주세요.');
    }, 30000);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저에서는 카메라를 사용할 수 없습니다. localhost 또는 HTTPS에서 Chrome으로 열어주세요.');
      const incoming = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user', ...(selectedId ? { deviceId: { exact: selectedId } } : {}) } });
      if (generation.current !== token) { incoming.getTracks().forEach(t => t.stop()); return; }
      stream.current = incoming;
      setDeviceId(incoming.getVideoTracks()[0].getSettings().deviceId ?? '');
      try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput')); } catch { setDevices([]); }
      if (generation.current !== token) return;
      incoming.getVideoTracks()[0].onended = () => {
        if (generation.current !== token) return;
        release(); setState('error'); setQuality(false); setBaseline(null); setCalibrationId(null); setProgress(null); setError('카메라 연결이 끊겼습니다. 다시 연결해 주세요.');
      };
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      if (generation.current !== token) return;
      let delegate: 'GPU' | 'CPU' = 'GPU';
      const create = (device: 'GPU' | 'CPU') => PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `/mediapipe/${modelAsset.filename}`, delegate: device },
        runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
      });
      let loaded: PoseLandmarker;
      try { loaded = await create('GPU'); }
      catch {
        if (generation.current !== token) return;
        delegate = 'CPU'; loaded = await create('CPU');
      }
      if (generation.current !== token) { loaded.close(); return; }
      detector.current = loaded;
      const video = videoRef.current;
      if (!video) throw new Error('카메라 화면을 준비하지 못했습니다. 다시 시도해 주세요.');
      video.srcObject = incoming; await video.play();
      if (generation.current !== token) return;
      if (loadingTimer.current !== null) clearTimeout(loadingTimer.current); loadingTimer.current = null;
      setState('on'); visualRef.current = { ...visualRef.current, startedAt: performance.now() };
      let previousTime = -1, previousRun = 0, previousDraw = 0, inferenceMs = 0;
      let target: Landmark[] = [], displayed: Landmark[] = [];
      let metricStart = performance.now(), frameCount = 0, inferenceSum = 0;
      const render = (time: number) => {
        if (generation.current !== token) return;
        const interval = inferenceInterval(delegate, inferenceMs);
        if (video.readyState >= 2 && time - previousRun >= interval && video.currentTime !== previousTime) {
          previousTime = video.currentTime; previousRun = time - ((time - previousRun) % interval);
          try {
            const started = performance.now();
            const result = loaded.detectForVideo(video, time);
            inferenceMs = performance.now() - started;
            frameCount++; inferenceSum += inferenceMs;
            const points = result.landmarks[0] ?? [];
            const f = features(points, video.videoWidth, video.videoHeight);
            const observationGap = time - lastFrame.current;
            current.current = f; lastFrame.current = time; setQuality(!!f);
            if (f && !target.length) visualRef.current = { ...visualRef.current, startedAt: performance.now() };
            target = f ? points : [];
            if (!f || observationGap > 1000) displayed = [];
            const observation: Observation = { timeMs: time, videoTimeMs: previousTime * 1000,
              landmarks: points, worldLandmarks: result.worldLandmarks[0] ?? [],
              features: f, inferenceMs, delegate, width: video.videoWidth, height: video.videoHeight };
            for (const listener of listeners.current) listener(observation);
            if (calibration.current) {
              const next = observeCalibration(calibration.current, f, time, observationGap);
              calibration.current = next.draft; setProgress(next.progress);
              if (next.ready) {
                setBaseline(next.ready); setCalibrationId(crypto.randomUUID()); calibration.current = null; setProgress(null);
              }
            }
          } catch {
            release(); setState('error'); setQuality(false); setProgress(null); setBaseline(null); setCalibrationId(null);
            setError('자세 추적을 이어갈 수 없습니다. 카메라를 다시 연결해 주세요.'); return;
          }
        }
        if (time - lastFrame.current > 1000) { current.current = null; setQuality(false); target = []; displayed = [];
          if (calibration.current) { calibration.current = beginCalibration(); setProgress(0); } }
        displayed = smoothPoints(displayed, target, previousDraw ? time - previousDraw : 16);
        previousDraw = time;
        drawPose(canvasRef.current, displayed, video.videoWidth, video.videoHeight, time, visualRef.current);
        if (time - metricStart >= 500) {
          setMetrics({ fps: frameCount * 1000 / (time - metricStart),
            inferenceMs: frameCount ? inferenceSum / frameCount : 0, delegate });
          metricStart = time; frameCount = 0; inferenceSum = 0;
        }
        raf.current = setTimeout(() => render(performance.now()), 33);
      };
      raf.current = setTimeout(() => render(performance.now()), 33);
    } catch (cause) {
      if (generation.current !== token) return;
      release(); setState('error'); setQuality(false);
      const name = cause instanceof Error ? cause.name : '';
      setError(name === 'NotAllowedError' ? '카메라 권한이 거부되었습니다. 브라우저의 사이트 권한에서 카메라를 허용해 주세요.'
        : name === 'NotFoundError' ? '연결된 카메라가 없습니다. 카메라를 연결해 주세요. 홈과 저장된 기록은 카메라 없이 볼 수 있습니다.'
        : name === 'NotReadableError' ? '카메라를 다른 앱에서 사용 중일 수 있습니다. 사용 중인 앱을 닫고 다시 시도해 주세요.'
        : cause instanceof Error && cause.message.startsWith('이 브라우저') ? cause.message
        : name === 'OverconstrainedError' ? '선택한 카메라를 사용할 수 없습니다. 다른 장치를 선택하거나 다시 연결해 주세요.'
        : '카메라 또는 자세 추적 모델을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
    }
  }, [release]);

  const calibrate = () => {
    if (state !== 'on' || !quality || calibration.current) return;
    setProgress(0); calibration.current = beginCalibration();
  };
  const cancelCalibration = () => { calibration.current = null; setProgress(null); };
  return { visual, setVisualMode, reassemble, setReducedMotion, setOverlayEnabled, metrics, subscribe, videoRef, canvasRef, streamRef: stream, devices, deviceId, state, error, quality, baseline, calibrationId, progress, current, lastFrame, connect, stop, calibrate, cancelCalibration };
}

export type CameraController = ReturnType<typeof useCamera>;
