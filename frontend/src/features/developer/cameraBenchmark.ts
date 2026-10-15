import { liveForecastPoints, pointDistance } from '../../../../model/prototype/forecast'
import { requestCamera, stopCameraTracks } from '../camera/devices'
import { createPoseTracker, type PoseTrackerDiagnostics, type PoseVariant, type PoseDelegate } from '../mediapipe'

export type BenchmarkStats = { count: number; mean: number; p50: number; p95: number; max: number }
export type BenchmarkResult = {
  variant: PoseVariant; delegate: PoseDelegate; round: number
  diagnostics: PoseTrackerDiagnostics | null; inference: BenchmarkStats
  validFrames: number; frames: number; validRate: number
  /** Consecutive normalized-coordinate change includes real movement; NOT ground-truth accuracy. */
  coordinateChange: BenchmarkStats; error: string | null
}
export type BenchmarkReport = {
  schema: 'dev-camera-benchmark-v1'; createdAt: string; userAgent: string
  width: number; height: number; captureFrames: number; captureDurationMs: number
  warmupFrames: number; rounds: number; results: BenchmarkResult[]
  note: string
}
export function benchmarkStats(values: number[]): BenchmarkStats {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  const q = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0
  return { count: sorted.length, mean: sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1), p50: q(.5), p95: q(.95), max: sorted.at(-1) ?? 0 }
}
export const BENCHMARK_CONFIGURATIONS: { variant: PoseVariant; delegate: PoseDelegate }[] =
  (['lite', 'full', 'heavy'] as const).flatMap(variant => (['GPU', 'CPU'] as const).map(delegate => ({ variant, delegate })))

/** Six-second, memory-only capture replayed identically in two counterbalanced rounds. */
export async function runCameraBenchmark(options: {
  onProgress: (text: string) => void; isCurrent: () => boolean; deviceId?: string
}): Promise<BenchmarkReport> {
  const { isCurrent, onProgress } = options
  const check = () => {
    if (!isCurrent()) throw new Error('비교를 중단했습니다.')
    if (document.visibilityState === 'hidden') throw new Error('화면이 숨겨져 비교를 중단했습니다. 화면을 연 채로 다시 시작해 주세요.')
  }
  const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
  const frames: HTMLCanvasElement[] = []
  const captureTimes: number[] = []
  const video = document.createElement('video')
  video.muted = true; video.playsInline = true
  let stream: MediaStream | null = null
  const report: BenchmarkReport = {
    schema: 'dev-camera-benchmark-v1', createdAt: new Date().toISOString(), userAgent: navigator.userAgent,
    width: 640, height: 480, captureFrames: 24, captureDurationMs: 0, warmupFrames: 4, rounds: 2, results: [],
    note: '동일한 웹캠 프레임을 두 번 재생. 2회차 역순. 워밍업 제외. 유효율은 앱의 13점 품질 통과율이며 정확도가 아님. 좌표 변동에는 실제 몸 움직임 포함. 영상·좌표 저장 안 함. 추론 시간은 카메라/화면 지연을 포함하지 않음.',
  }
  try {
    check()
    onProgress('카메라 준비 중 · 얼굴과 양어깨를 보이고 6초간 편하게 멈춰 주세요.')
    stream = await requestCamera(options.deviceId); check()
    video.srcObject = stream; await video.play(); check()
    // Camera exposure settles before the shared sample is captured.
    await pause(800); check()
    report.width = video.videoWidth; report.height = video.videoHeight
    if (!report.width || !report.height) throw new Error('카메라 프레임 크기를 읽지 못했습니다.')
    const captureStart = performance.now()
    let previousVideoTime = -1
    for (let i = 0; i < report.captureFrames; i++) {
      check()
      const waitingSince = performance.now()
      while (video.currentTime === previousVideoTime || video.readyState < 2) {
        check()
        if (performance.now() - waitingSince > 1000) throw new Error('카메라 프레임이 멈춰 비교를 중단했습니다.')
        await pause(25)
      }
      previousVideoTime = video.currentTime
      onProgress(`같은 입력 촬영 중 ${i + 1}/${report.captureFrames} · 얼굴과 양어깨를 보이고 잠시 멈춰 주세요.`)
      const canvas = document.createElement('canvas')
      canvas.width = report.width; canvas.height = report.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('비교용 프레임을 준비하지 못했습니다.')
      context.drawImage(video, 0, 0); frames.push(canvas); captureTimes.push(video.currentTime * 1000)
      await pause(250)
    }
    report.captureDurationMs = performance.now() - captureStart
    stopCameraTracks(stream); stream = null; video.srcObject = null
    for (let round = 1; round <= report.rounds; round++) {
      const configurations = round === 1 ? BENCHMARK_CONFIGURATIONS : [...BENCHMARK_CONFIGURATIONS].reverse()
      for (const configuration of configurations) {
        check()
        const { variant, delegate } = configuration
        onProgress(`${round}/2회 · ${variant.toUpperCase()} ${delegate} 준비 중`)
        const result: BenchmarkResult = {
          ...configuration, round, diagnostics: null, inference: benchmarkStats([]), validFrames: 0,
          frames: 0, validRate: 0, coordinateChange: benchmarkStats([]), error: null,
        }
        let tracker: Awaited<ReturnType<typeof createPoseTracker>> = null
        try {
          tracker = await createPoseTracker(isCurrent, configuration); check()
          if (!tracker) throw new Error('모델 준비가 취소되었습니다.')
          result.diagnostics = tracker.diagnostics ?? null
          let timestamp = 0
          for (let i = 0; i < report.warmupFrames; i++) {
            // Warm the first pose without an artificial frame 4 → frame 1 jump.
            check(); tracker.detectFrame(frames[0], timestamp += 250); await pause(0)
          }
          const timings: number[] = [], changes: number[] = []
          let previous: number[] | null = null
          for (let i = 0; i < frames.length; i++) {
            check()
            onProgress(`${round}/2회 · ${variant.toUpperCase()} ${delegate} 비교 중 ${i + 1}/${frames.length}`)
            const started = performance.now()
            const frame = tracker.detectFrame(frames[i], timestamp + 250 + captureTimes[i] - captureTimes[0])
            timings.push(performance.now() - started)
            const points = liveForecastPoints(frame.landmarks, frame.worldLandmarks)
            if (points) result.validFrames++
            if (points && previous) changes.push(pointDistance(points, previous))
            previous = points
            result.frames++
            // Release the main thread between calls; excluded from inference duration.
            await pause(0)
          }
          result.inference = benchmarkStats(timings)
          result.coordinateChange = benchmarkStats(changes)
          result.validRate = result.validFrames / result.frames
        } catch (error) {
          check()
          result.error = error instanceof Error ? error.message : String(error)
        } finally { tracker?.close() }
        report.results.push(result)
        await pause(100)
      }
    }
    onProgress('비교 완료 · 촬영 프레임은 메모리에서 해제했습니다.')
    return report
  } finally {
    stopCameraTracks(stream); video.pause(); video.srcObject = null
    frames.forEach(frame => { frame.width = 0; frame.height = 0 }); frames.length = 0
  }
}
