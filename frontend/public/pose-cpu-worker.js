/* CPU inference runs in a classic worker so MediaPipe can load its local WASM scripts. */
importScripts('/mediapipe/vision_bundle.js')
let detector
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'init') {
      const files = await Vision.FilesetResolver.forVisionTasks(self.location.origin + '/mediapipe/wasm')
      detector = await Vision.PoseLandmarker.createFromOptions(files, data.options)
      self.postMessage({ id: data.id, ready: true })
    } else {
      const result = detector.detectForVideo(data.image, data.time)
      self.postMessage({ id: data.id, result: { landmarks: result.landmarks, worldLandmarks: result.worldLandmarks } })
    }
  } catch (error) {
    console.error('[camera CPU worker] Operation failed', error)
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) })
  } finally {
    data.image?.close()
  }
}
