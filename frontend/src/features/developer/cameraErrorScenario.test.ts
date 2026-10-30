import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCameraErrorScenario } from './cameraErrorScenario'
import { CAMERA_ERRORS, cameraPreparationError } from '../camera/errors'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('code-driven camera fault injection', () => {
  it.each(Object.keys(CAMERA_ERRORS) as Array<keyof typeof CAMERA_ERRORS>)('runs %s through the media/model/tracking error path', async key => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const realCamera = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: realCamera } })
    const phases: string[] = []
    const disposers: Array<() => void> = []
    const task = runCameraErrorScenario(key, ms => new Promise(resolve => setTimeout(resolve, ms)), () => true, phase => phases.push(phase), stop => disposers.push(stop))
    const outcome = task.catch(error => cameraPreparationError(error))
    await vi.advanceTimersByTimeAsync(7000)
    expect(await outcome).toBe(CAMERA_ERRORS[key])
    expect(phases[0]).toBe('permission')
    if (key === 'trackingFailed' || key === 'disconnected') expect(phases).toContain('tracking')
    expect(realCamera).not.toHaveBeenCalled()
    disposers.forEach(stop => stop())
    expect(vi.getTimerCount()).toBe(0)
  })
})
