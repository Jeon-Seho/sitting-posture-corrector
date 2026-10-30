import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissPerformanceNotice, getPerformanceNotice, probeAcceleration, reportPerformance, subscribePerformanceNotice } from './acceleration'

afterEach(() => { dismissPerformanceNotice(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function graphics(renderer: string, debug = true) {
  const loseContext = vi.fn()
  const gl = {
    getParameter: vi.fn(() => renderer),
    getExtension: vi.fn((name: string) => name === 'WEBGL_lose_context' ? { loseContext }
      : debug ? { UNMASKED_RENDERER_WEBGL: 1 } : null),
  }
  const getContext = vi.fn(() => gl)
  vi.stubGlobal('document', { createElement: vi.fn(() => ({ getContext })) })
  return { getContext, loseContext }
}

describe('browser graphics capability hints', () => {
  it('requires WebGL2 without a major performance caveat and releases the probe context', () => {
    const { getContext, loseContext } = graphics('Synthetic hardware renderer')
    expect(probeAcceleration()).toBe('available')
    expect(getContext).toHaveBeenCalledWith('webgl2', { failIfMajorPerformanceCaveat: true })
    expect(loseContext).toHaveBeenCalledOnce()
  })
  it.each(['Google SwiftShader', 'llvmpipe', 'Microsoft Basic Render Driver'])('detects software rendering: %s', (renderer) => {
    graphics(renderer)
    expect(probeAcceleration()).toBe('limited')
  })
  it('reports unavailable WebGL2 as limited', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
    expect(probeAcceleration()).toBe('limited')
  })
  it('does not claim acceleration is enabled when renderer details are hidden', () => {
    const { loseContext } = graphics('', false)
    expect(probeAcceleration()).toBe('unknown')
    expect(loseContext).toHaveBeenCalledOnce()
  })
  it('logs capability probe exceptions and returns unknown', () => {
    const error = new Error('Synthetic graphics restriction')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('document', { createElement: () => { throw error } })
    expect(probeAcceleration()).toBe('unknown')
    expect(log).toHaveBeenCalledWith(expect.any(String), error)
  })
  it('deduplicates automatic notices but allows developer previews', () => {
    const listener = vi.fn()
    const unsubscribe = subscribePerformanceNotice(listener)
    reportPerformance('limited', true)
    expect(getPerformanceNotice()).toBe('limited')
    dismissPerformanceNotice()
    reportPerformance('limited')
    expect(getPerformanceNotice()).toBe('limited')
    dismissPerformanceNotice()
    reportPerformance('limited')
    expect(getPerformanceNotice()).toBeNull()
    reportPerformance('limited', true)
    expect(listener).toHaveBeenCalledTimes(5)
    unsubscribe()
  })
  it('does not show browser notices in the desktop app', () => {
    vi.stubGlobal('window', { posegoodDesktop: { version: 1 } })
    reportPerformance('cpu', true)
    expect(getPerformanceNotice()).toBeNull()
  })
})
