import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPoseDetector } from './modelLoader'

const vision = vi.hoisted(() => ({ resolve: vi.fn(), create: vi.fn() }))
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vision.resolve },
  PoseLandmarker: { createFromOptions: vision.create },
}))

describe('detector delegate fallback', () => {
  beforeEach(() => { vision.resolve.mockReset().mockResolvedValue({}); vision.create.mockReset() })
  afterEach(() => vi.restoreAllMocks())

  it('logs the GPU initialization cause and retries CPU once', async () => {
    const cause = new Error('Synthetic GPU initialization failure')
    const detector = { close: vi.fn() }
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vision.create.mockRejectedValueOnce(cause).mockResolvedValueOnce(detector)
    expect(await loadPoseDetector(() => true)).toEqual({ detector, delegate: 'CPU' })
    expect(log).toHaveBeenCalledWith(expect.any(String), cause)
    expect(vision.create.mock.calls.map((call) => call[1].baseOptions.delegate)).toEqual(['GPU', 'CPU'])
  })
  it('propagates failure when both delegates fail', async () => {
    const cpuError = new Error('Synthetic CPU failure')
    vision.create.mockRejectedValueOnce(new Error('Synthetic GPU failure')).mockRejectedValueOnce(cpuError)
    await expect(loadPoseDetector(() => true)).rejects.toBe(cpuError)
    expect(vision.create).toHaveBeenCalledTimes(2)
  })
  it('does not start CPU fallback after cancellation', async () => {
    let current = true
    vision.create.mockImplementationOnce(async () => { current = false; throw new Error('Synthetic canceled GPU') })
    expect(await loadPoseDetector(() => current)).toBeNull()
    expect(vision.create).toHaveBeenCalledOnce()
  })
  it('does not retry a failed explicit CPU recovery', async () => {
    vision.create.mockRejectedValueOnce(new Error('Synthetic CPU recovery failure'))
    await expect(loadPoseDetector(() => true, 'CPU')).rejects.toThrow('Synthetic CPU recovery failure')
    expect(vision.create).toHaveBeenCalledOnce()
  })
})
