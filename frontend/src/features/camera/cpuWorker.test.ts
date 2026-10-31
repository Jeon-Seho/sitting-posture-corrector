import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCpuWorker } from './cpuWorker'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
type WorkerReply = { data: { id: number; result?: unknown; error?: string } }
describe('CPU worker ownership', () => {
  function setup(reply = true) {
    const image = { close: vi.fn() }
    const worker = { onmessage: null as ((event: WorkerReply) => void) | null, onerror: null as ((event: unknown) => void) | null, terminate: vi.fn(), postMessage: vi.fn((data: { id: number; kind: string }) => {
      if (reply) queueMicrotask(() => worker.onmessage!({ data: { id: data.id, result: data.kind === 'frame' ? { landmarks: [], worldLandmarks: [] } : undefined } }))
    }) }
    vi.stubGlobal('Worker', class { constructor() { return worker } })
    vi.stubGlobal('createImageBitmap', vi.fn(async () => image))
    return { worker, image }
  }
  it('transfers frames and releases images and worker', async () => {
    const { worker, image } = setup()
    const detector = await createCpuWorker({})
    expect(await detector.detectForVideo({} as HTMLVideoElement, 1)).toEqual({ landmarks: [], worldLandmarks: [] })
    expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'frame', time: 1 }), [image])
    expect(image.close).toHaveBeenCalled()
    detector.close()
    detector.close()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('terminates an unresponsive initialization on deadline', async () => {
    vi.useFakeTimers()
    const { worker } = setup(false)
    const result = createCpuWorker({})
    const assertion = expect(result).rejects.toThrow('closed')
    await vi.advanceTimersByTimeAsync(15001)
    await assertion
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('rejects pending frames on close instead of leaving promises waiting', async () => {
    const { worker } = setup()
    const detector = await createCpuWorker({})
    worker.postMessage.mockImplementation(() => {})
    const result = detector.detectForVideo({} as HTMLVideoElement, 1)
    const assertion = expect(result).rejects.toThrow('closed')
    await Promise.resolve()
    detector.close()
    await assertion
  })
})
