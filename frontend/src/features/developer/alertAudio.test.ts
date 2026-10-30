import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeveloperAlertAudio } from './alertAudio'

class FakeParam {
  setValueAtTime = vi.fn()
  linearRampToValueAtTime = vi.fn()
  exponentialRampToValueAtTime = vi.fn()
  cancelScheduledValues = vi.fn()
}
class FakeGain {
  gain = new FakeParam()
  connect = vi.fn()
  disconnect = vi.fn()
}
class FakeOscillator {
  type = ''
  frequency = new FakeParam()
  onended: (() => void) | null = null
  connect = vi.fn()
  disconnect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}
const contexts: FakeAudioContext[] = []
class FakeAudioContext {
  state: AudioContextState = 'suspended'
  currentTime = 10
  destination = {}
  oscillators: FakeOscillator[] = []
  gains: FakeGain[] = []
  constructor() { contexts.push(this) }
  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
  createOscillator = vi.fn(() => { const oscillator = new FakeOscillator(); this.oscillators.push(oscillator); return oscillator })
  createGain = vi.fn(() => { const gain = new FakeGain(); this.gains.push(gain); return gain })
}
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  contexts.length = 0
  vi.stubGlobal('window', { AudioContext: FakeAudioContext })
})
afterEach(() => vi.unstubAllGlobals())

describe('local developer alert audio using fake AudioContext only', () => {
  it('creates and resumes audio only when explicitly armed, never from beep or construction', async () => {
    const audio = new DeveloperAlertAudio()
    expect(contexts).toHaveLength(0)
    expect(audio.beep()).toBe(false)
    expect(contexts).toHaveLength(0)
    expect(await audio.arm()).toBe('ready')
    expect(contexts).toHaveLength(1)
    expect(contexts[0].resume).toHaveBeenCalledOnce()
    expect(contexts[0].oscillators).toHaveLength(0)
    expect(await audio.arm()).toBe('ready')
    expect(contexts).toHaveLength(1)
    expect(contexts[0].resume).toHaveBeenCalledOnce()
  })

  it('schedules two soft notes locally with no delayed JavaScript callback', async () => {
    const audio = new DeveloperAlertAudio(); await audio.arm()
    const context = contexts[0]
    expect(audio.beep()).toBe(true)
    expect(context.oscillators).toHaveLength(2)
    for (const [index, oscillator] of context.oscillators.entries()) {
      const start = 10.01 + index * .25, gain = context.gains[index]
      expect(oscillator.type).toBe('sine')
      expect(oscillator.start).toHaveBeenCalledWith(start)
      expect(oscillator.stop).toHaveBeenCalledWith(start + .24)
      expect(oscillator.connect).toHaveBeenCalledWith(gain)
      expect(gain.connect).toHaveBeenCalledWith(context.destination)
      expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0, start)
      expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(.04, start + .025)
      expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, start + .22)
    }
    expect(context.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(659.25, 10.01)
    expect(context.oscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(523.25, 10.26)
  })

  it('cancels both active and future notes and requires a new gesture after mute or stop', async () => {
    const audio = new DeveloperAlertAudio(); await audio.arm(); audio.beep()
    const context = contexts[0]; context.currentTime = 10.05
    audio.cancel()
    for (const [index, oscillator] of context.oscillators.entries()) {
      expect(oscillator.stop).toHaveBeenLastCalledWith(10.05)
      expect(oscillator.disconnect).toHaveBeenCalledOnce()
      expect(oscillator.onended).toBeNull()
      expect(context.gains[index].gain.cancelScheduledValues).toHaveBeenCalledWith(10.05)
      expect(context.gains[index].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 10.05)
      expect(context.gains[index].disconnect).toHaveBeenCalledOnce()
    }
    expect(audio.beep()).toBe(false)
    expect(await audio.arm()).toBe('ready')
    expect(contexts).toHaveLength(1)
    expect(audio.beep()).toBe(true)
  })

  it('does not stack repeated alerts and detaches nodes when playback ends', async () => {
    const audio = new DeveloperAlertAudio(); await audio.arm(); audio.beep()
    const context = contexts[0], firstPair = [...context.oscillators]
    expect(audio.beep()).toBe(true)
    expect(context.oscillators).toHaveLength(4)
    for (const oscillator of firstPair) expect(oscillator.disconnect).toHaveBeenCalledOnce()
    for (const oscillator of context.oscillators.slice(2)) oscillator.onended?.()
    audio.cancel()
    for (const oscillator of context.oscillators) expect(oscillator.disconnect).toHaveBeenCalledOnce()
  })

  it('leaves unavailable or suspended audio silent without auto-resuming from beep', async () => {
    vi.stubGlobal('window', {})
    const unavailable = new DeveloperAlertAudio()
    expect(await unavailable.arm()).toBe('unsupported')
    expect(unavailable.beep()).toBe(false)
    vi.stubGlobal('window', { AudioContext: FakeAudioContext })
    const audio = new DeveloperAlertAudio(); await audio.arm()
    const context = contexts[0]; context.state = 'suspended'
    expect(audio.beep()).toBe(false)
    expect(context.resume).toHaveBeenCalledOnce()
    expect(context.oscillators).toHaveLength(0)
  })

  it('supports prefixed AudioContext and handles constructor or resume rejection', async () => {
    vi.stubGlobal('window', { webkitAudioContext: FakeAudioContext })
    expect(await new DeveloperAlertAudio().arm()).toBe('ready')
    vi.stubGlobal('window', { AudioContext: class { constructor() { throw new Error('audio denied') } } })
    expect(await new DeveloperAlertAudio().arm()).toBe('blocked')
    class DeniedContext extends FakeAudioContext {
      resume = vi.fn(async () => { throw new Error('resume blocked') })
    }
    vi.stubGlobal('window', { AudioContext: DeniedContext })
    const audio = new DeveloperAlertAudio()
    expect(await audio.arm()).toBe('blocked')
    expect(audio.beep()).toBe(false)
    expect(contexts.at(-1)!.oscillators).toHaveLength(0)
  })

  it('clears old suspended notes before a new gesture unlocks the context', async () => {
    const audio = new DeveloperAlertAudio(); await audio.arm(); audio.beep()
    const context = contexts[0]; context.state = 'suspended'
    expect(await audio.arm()).toBe('ready')
    for (const oscillator of context.oscillators) {
      expect(oscillator.stop).toHaveBeenLastCalledWith(context.currentTime)
      expect(oscillator.disconnect).toHaveBeenCalledOnce()
    }
    context.state = 'suspended'
    context.resume.mockImplementationOnce(async () => {})
    expect(await audio.arm()).toBe('blocked')
    expect(audio.beep()).toBe(false)
  })

  it('invalidates pending preparation when cancelled and can be armed again later', async () => {
    const pending = deferred()
    class PendingContext extends FakeAudioContext {
      resume = vi.fn(async () => { await pending.promise; this.state = 'running' })
    }
    vi.stubGlobal('window', { AudioContext: PendingContext })
    const audio = new DeveloperAlertAudio(), arming = audio.arm()
    audio.cancel(); pending.resolve()
    expect(await arming).toBe('inactive')
    expect(audio.beep()).toBe(false)
    expect(await audio.arm()).toBe('ready')
    expect(contexts).toHaveLength(1)
  })

  it('disposes pending work permanently and safely closes the context once', async () => {
    const pending = deferred()
    class PendingContext extends FakeAudioContext { resume = vi.fn(() => pending.promise) }
    vi.stubGlobal('window', { AudioContext: PendingContext })
    const audio = new DeveloperAlertAudio(), arming = audio.arm()
    audio.dispose(); audio.dispose(); pending.resolve()
    expect(await arming).toBe('inactive')
    expect(contexts[0].close).toHaveBeenCalledOnce()
    expect(await audio.arm()).toBe('inactive')
    expect(audio.beep()).toBe(false)
    expect(contexts).toHaveLength(1)
  })

  it('cleans up partial scheduling failures instead of leaving the first note queued', async () => {
    const audio = new DeveloperAlertAudio(); await audio.arm()
    const context = contexts[0]
    context.createGain.mockImplementationOnce(() => {
      const gain = new FakeGain(); context.gains.push(gain); return gain
    }).mockImplementationOnce(() => { throw new Error('node allocation failed') })
    expect(audio.beep()).toBe(false)
    expect(context.oscillators).toHaveLength(2)
    for (const oscillator of context.oscillators) {
      expect(oscillator.stop).toHaveBeenLastCalledWith(context.currentTime)
      expect(oscillator.disconnect).toHaveBeenCalledOnce()
    }
    expect(context.gains[0].gain.cancelScheduledValues).toHaveBeenCalledOnce()
    expect(audio.beep()).toBe(false)
  })
})
