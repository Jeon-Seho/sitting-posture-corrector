import type { PoseLandmarkerOptions, PoseLandmarkerResult } from '@mediapipe/tasks-vision'

type Detection = Pick<PoseLandmarkerResult, 'landmarks' | 'worldLandmarks'>

export type PoseDetector = {
  close: () => void
  detectForVideo: (video: HTMLVideoElement, time: number) => Pick<PoseLandmarkerResult, 'landmarks' | 'worldLandmarks'> | Promise<Pick<PoseLandmarkerResult, 'landmarks' | 'worldLandmarks'>>
}

/** One outstanding frame; close/timeout reject pending work and terminate the worker. */
export async function createCpuWorker(options: PoseLandmarkerOptions): Promise<PoseDetector> {
  const worker = new Worker('/pose-cpu-worker.js')
  let closed = false
  let sequence = 0
  const pending = new Map<number, { resolve: (value: Detection | undefined) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const close = () => {
    if (closed) return
    closed = true
    worker.terminate()
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CPU worker closed')) }
    pending.clear()
  }
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    clearTimeout(request.timer)
    if (data.error) request.reject(new Error(data.error))
    else request.resolve(data.result)
  }
  worker.onerror = (event) => {
    console.error('[camera] CPU worker failed', event.message)
    close()
  }
  const send = (data: object, transfer: Transferable[] = []) => new Promise<Detection | undefined>((resolve, reject) => {
    if (closed) { reject(new Error('CPU worker closed')); return }
    const id = ++sequence
    const timer = setTimeout(() => { close() }, 15_000)
    pending.set(id, { resolve, reject, timer })
    try { worker.postMessage({ ...data, id }, transfer) }
    catch (error) { console.error('[camera] CPU worker transfer failed', error); close() }
  })
  try {
    await send({ kind: 'init', options })
    return {
      close,
      async detectForVideo(video, time) {
        if (closed) throw new Error('CPU worker closed')
        const image = await createImageBitmap(video)
        if (closed) { image.close(); throw new Error('CPU worker closed') }
        try {
          const result = await send({ kind: 'frame', image, time }, [image])
          if (!result) throw new Error('CPU worker returned no result')
          return result
        }
        finally { image.close() }
      },
    }
  } catch (error) { console.error('[camera] CPU worker initialization failed', error); close(); throw error }
}
