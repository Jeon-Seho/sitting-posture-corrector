import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAMERA_ERRORS } from './errors'
import { MODEL_FILES, modelLoadError } from './modelFailure'

afterEach(() => vi.unstubAllGlobals())

const answer = (status: number) => new Response(null, { status })

describe('why the pose model did not load', () => {
  it('blames the connection when the browser is offline, without asking the server', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const probe = vi.fn()
    expect(await modelLoadError(probe)).toBe(CAMERA_ERRORS.modelOffline)
    expect(probe).not.toHaveBeenCalled()
  })

  it('blames the connection when the server cannot be reached', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await modelLoadError(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))).toBe(CAMERA_ERRORS.modelOffline)
  })

  it.each([404, 500, 502])('blames our server when a model file answers %i', async (status) => {
    vi.stubGlobal('navigator', { onLine: true })
    const probe = vi.fn((file: string) => Promise.resolve(answer(file.endsWith('.wasm') ? 200 : status)))
    expect(await modelLoadError(probe as unknown as typeof fetch)).toBe(CAMERA_ERRORS.modelServer)
  })

  it('blames the browser when every file is there', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const probe = vi.fn((_file: string, _init?: RequestInit) => Promise.resolve(answer(200)))
    expect(await modelLoadError(probe as unknown as typeof fetch)).toBe(CAMERA_ERRORS.modelUnsupported)
    expect(probe.mock.calls.map(([file]) => file)).toEqual(MODEL_FILES)
    expect(probe.mock.calls[0][1]).toEqual({ method: 'HEAD', cache: 'no-store' })
  })
})
