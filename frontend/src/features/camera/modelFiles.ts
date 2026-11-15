/**
 * The pose model and its WebAssembly engine (about 42MB together) are downloaded here, not by
 * MediaPipe, so a slow connection is never cut off by a time limit: the download goes on while bytes
 * keep arriving, and the camera box shows how far it got. Only a download that stops receiving for
 * `STALL_MS` is given up. Finished files stay in memory, so 「다시 연결」 and the CPU fallback do not
 * download them again.
 */
export type DownloadProgress = { loaded: number; total: number | null }

export const STALL_MS = 15_000

/** Thrown when nothing arrived for `STALL_MS`. */
export class ModelDownloadStalled extends Error {
  constructor() {
    super('Model download stalled')
    this.name = 'ModelDownloadStalled'
  }
}

const finished = new Map<string, Uint8Array>()

async function download(url: string, onBytes: (loaded: number, total: number | null) => void, fetcher: typeof fetch) {
  const done = finished.get(url)
  if (done) {
    onBytes(done.byteLength, done.byteLength)
    return done
  }
  const abort = new AbortController()
  let stalled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const watch = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { stalled = true; abort.abort() }, STALL_MS)
  }
  watch()
  try {
    const response = await fetcher(url, { signal: abort.signal })
    if (!response.ok || !response.body) throw new Error(`Model file ${url} answered ${response.status}`)
    const size = Number(response.headers.get('content-length')) || null
    const reader = response.body.getReader()
    const parts: Uint8Array[] = []
    let loaded = 0
    onBytes(0, size)
    for (;;) {
      const { done: end, value } = await reader.read()
      if (end) break
      watch()
      parts.push(value)
      loaded += value.byteLength
      onBytes(loaded, size)
    }
    if (stalled) throw new ModelDownloadStalled()
    const bytes = new Uint8Array(loaded)
    let offset = 0
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
    finished.set(url, bytes)
    return bytes
  } catch (error) {
    if (stalled) throw new ModelDownloadStalled()
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Downloads every file at once and reports the combined progress. */
export async function downloadModelFiles(
  urls: string[],
  onProgress: (progress: DownloadProgress) => void = () => {},
  fetcher: typeof fetch = (...args) => fetch(...args),
): Promise<Uint8Array[]> {
  const state = urls.map(() => ({ loaded: 0, total: null as number | null }))
  const report = () => {
    const known = state.every((file) => file.total !== null)
    onProgress({
      loaded: state.reduce((sum, file) => sum + file.loaded, 0),
      total: known ? state.reduce((sum, file) => sum + (file.total ?? 0), 0) : null,
    })
  }
  return Promise.all(urls.map((url, index) => download(url, (loaded, total) => {
    state[index] = { loaded, total }
    report()
  }, fetcher)))
}

/** For tests: forget the files kept in memory. */
export function forgetModelFiles() {
  finished.clear()
}
