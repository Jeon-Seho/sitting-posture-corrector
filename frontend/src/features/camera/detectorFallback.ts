import type { CameraDelegate } from './types'

/** Shared by real initialization and isolated fault scenarios. Late resources are always closed. */
export async function detectorFallback<T extends { close: () => void }>(
  create: (delegate: CameraDelegate) => Promise<T>, isCurrent: () => boolean,
  preferred: CameraDelegate = 'GPU', timeoutMs = 30_000,
): Promise<{ detector: T; delegate: CameraDelegate } | null> {
  let active = true
  let timer: ReturnType<typeof setTimeout>
  const createCurrent = async (delegate: CameraDelegate) => {
    const detector = await create(delegate)
    if (!active || !isCurrent()) { detector.close(); return null }
    return { detector, delegate }
  }
  const work = async () => {
    if (!isCurrent()) return null
    try { return await createCurrent(preferred) }
    catch (error) {
      console.error(`[camera] ${preferred} detector initialization failed`, error)
      if (!active || !isCurrent()) return null
      if (preferred === 'CPU') throw error
      try { return await createCurrent('CPU') }
      catch (cause) { console.error('[camera] CPU detector initialization failed', cause); throw cause }
    }
  }
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { active = false; reject(new Error('Detector preparation timed out')) }, timeoutMs)
  })
  try { return await Promise.race([work(), timeout]) }
  finally { active = false; clearTimeout(timer!) }
}
