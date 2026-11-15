import modelAsset from '../../../model-asset.json'
import { CAMERA_ERRORS } from './errors'

/** The files `loadPoseDetector` downloads from our own web server. */
export const MODEL_FILES = ['/mediapipe/wasm/vision_wasm_internal.wasm', `/mediapipe/${modelAsset.filename}`]

/**
 * Why the pose model did not load, told the way the user can act on it:
 * - offline, or no answer at all → their connection (they can fix it)
 * - our server answers but a file is missing or failing (404·5xx) → the server (they can only wait)
 * - the files are there but the browser could not start the model → the browser (update it)
 */
export async function modelLoadError(probe: typeof fetch = (...args) => fetch(...args)): Promise<string> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return CAMERA_ERRORS.modelOffline
  try {
    const answers = await Promise.all(MODEL_FILES.map((file) => probe(file, { method: 'HEAD', cache: 'no-store' })))
    return answers.every((answer) => answer.ok) ? CAMERA_ERRORS.modelUnsupported : CAMERA_ERRORS.modelServer
  } catch (cause) {
    console.error('[features/camera/modelFailure.ts:modelLoadError] Model files unreachable', cause)
    return CAMERA_ERRORS.modelOffline
  }
}
