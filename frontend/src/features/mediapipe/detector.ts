import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { POSE_CONFIG, POSE_MODELS } from './config'
import { shoulderUpLandmarks } from './landmarks'
import type { PoseDelegate, PoseTracker, PoseTrackerDiagnostics, PoseTrackerOptions } from './types'

function gpuCanvas() {
  // Main-thread HTML canvas also works in browsers with partial OffscreenCanvas
  // WebGL support. A future worker can use the same adapter's offscreen branch.
  if (typeof document !== 'undefined') return document.createElement('canvas')
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1)
  return undefined
}

function graphicsDiagnostics(canvas: HTMLCanvasElement | OffscreenCanvas | undefined): PoseTrackerDiagnostics['graphics'] {
  try {
    const gl = canvas?.getContext('webgl2') as WebGL2RenderingContext | null | undefined
    if (!gl) return null
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)).slice(0, 512)
    const vendor = String(gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)).slice(0, 512)
    return Object.freeze({
      renderer, vendor, version: String(gl.getParameter(gl.VERSION)).slice(0, 256),
      softwareRenderer: /swiftshader|llvmpipe|softpipe|software rasterizer/i.test(renderer),
    })
  } catch { return null }
}

/** A canceled connection never adopts a late model or starts a CPU retry. */
export async function createPoseTracker(
  isCurrent: () => boolean,
  options: PoseTrackerOptions = {},
): Promise<PoseTracker | null> {
  if (!isCurrent()) return null
  const started = performance.now()
  const variant = options.variant ?? 'heavy'
  const requestedDelegate = options.delegate ?? 'auto'
  const asset = POSE_MODELS[variant]
  const vision = await FilesetResolver.forVisionTasks(POSE_CONFIG.wasmPath)
  if (!isCurrent()) return null

  let canvas: HTMLCanvasElement | OffscreenCanvas | undefined
  const createDetector = (delegate: PoseDelegate) => {
    // Inspect the context actually passed to the SDK, not an unrelated GPU probe.
    canvas = delegate === 'GPU' ? gpuCanvas() : undefined
    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: `/mediapipe/${asset.filename}`, delegate },
      ...(canvas ? { canvas } : {}),
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: POSE_CONFIG.minPoseDetectionConfidence,
      minPosePresenceConfidence: POSE_CONFIG.minPosePresenceConfidence,
      minTrackingConfidence: POSE_CONFIG.minTrackingConfidence,
    })
  }

  let delegate: PoseDelegate = requestedDelegate === 'CPU' ? 'CPU' : 'GPU'
  let fallbackReason: string | null = null
  let detector: PoseLandmarker
  try {
    detector = await createDetector(delegate)
  } catch (error) {
    if (!isCurrent()) return null
    // A GPU benchmark must fail honestly rather than become a mislabeled CPU run.
    if (requestedDelegate !== 'auto') throw error
    fallbackReason = error instanceof Error ? error.message.slice(0, 240) : 'GPU initialization failed'
    delegate = 'CPU'
    detector = await createDetector(delegate)
  }

  if (!isCurrent()) {
    detector.close()
    return null
  }
  let closed = false
  return {
    delegate,
    diagnostics: Object.freeze({
      variant, modelId: asset.modelId, requestedDelegate, actualDelegate: delegate,
      fallbackReason, initializationMs: performance.now() - started,
      graphics: delegate === 'GPU' ? graphicsDiagnostics(canvas) : null,
    }),
    detectFrame(input, timeMs, capturedVideoTimeMs) {
      if (closed) throw new Error('Pose tracker is closed')
      const isVideo = 'videoWidth' in input
      const videoTimeMs = capturedVideoTimeMs ?? (isVideo ? input.currentTime * 1_000 : timeMs)
      const started = performance.now()
      const result = detector.detectForVideo(input, timeMs)
      const inferenceMs = performance.now() - started
      return {
        ...shoulderUpLandmarks(result),
        poseModelId: asset.modelId,
        timeMs,
        videoTimeMs,
        inferenceMs,
        delegate,
        width: isVideo ? input.videoWidth : input.width,
        height: isVideo ? input.videoHeight : input.height,
      }
    },
    close: () => { if (!closed) { closed = true; detector.close() } },
  }
}
