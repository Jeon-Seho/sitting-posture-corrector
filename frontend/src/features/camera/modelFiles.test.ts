import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadModelFiles, forgetModelFiles, ModelDownloadStalled, STALL_MS } from './modelFiles'
import { modelDownloadText } from '../../components/CameraStage'

afterEach(() => { vi.useRealTimers(); forgetModelFiles() })

/** A response whose chunks arrive when `push` is called. */
function slowResponse(size: number) {
  let control!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => { control = c } })
  return {
    response: new Response(body, { headers: { 'content-length': String(size) } }),
    push: (bytes: number) => control.enqueue(new Uint8Array(bytes)),
    end: () => control.close(),
  }
}

describe('pose model download', () => {
  it('has no time limit while bytes keep arriving, and reports progress', async () => {
    vi.useFakeTimers()
    const file = slowResponse(30)
    const progress: Array<{ loaded: number; total: number | null }> = []
    const task = downloadModelFiles(['/mediapipe/model.task'], (p) => progress.push(p), () => Promise.resolve(file.response))
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(STALL_MS - 1000)
      file.push(10)
    }
    file.end()
    const [bytes] = await task
    expect(bytes.byteLength).toBe(30)
    expect(progress.at(-1)).toEqual({ loaded: 30, total: 30 })
  })

  it('gives up only when nothing arrives for the stall time', async () => {
    vi.useFakeTimers()
    const file = slowResponse(30)
    const task = downloadModelFiles(['/mediapipe/model.task'], undefined, (_url, init) => {
      init?.signal?.addEventListener('abort', () => file.end())
      return Promise.resolve(file.response)
    })
    const outcome = task.catch((error) => error)
    file.push(10)
    await vi.advanceTimersByTimeAsync(STALL_MS + 10)
    expect(await outcome).toBeInstanceOf(ModelDownloadStalled)
  })

  it('keeps finished files, so 「다시 연결」 does not download them again', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response(new Uint8Array(5))))
    await downloadModelFiles(['/a'], undefined, fetcher as unknown as typeof fetch)
    await downloadModelFiles(['/a'], undefined, fetcher as unknown as typeof fetch)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('shows the progress in megabytes', () => {
    expect(modelDownloadText({ loaded: 12.5 * 1024 * 1024, total: 41.6 * 1024 * 1024 })).toBe('자세 추적 모델을 받고 있어요 (12 / 42MB)')
    expect(modelDownloadText({ loaded: 3 * 1024 * 1024, total: null })).toBe('자세 추적 모델을 받고 있어요 (3MB)')
  })
})
