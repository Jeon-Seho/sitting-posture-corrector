import type { LabAudioStatus } from './types'

type AudioWindow = Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
interface Tone { oscillator: OscillatorNode; gain: GainNode | null }

/** Local research feedback only. Call arm from an explicit user gesture. */
export class DeveloperAlertAudio {
  private context: AudioContext | null = null
  private armed = false
  private disposed = false
  private generation = 0
  private tones = new Set<Tone>()

  async arm(): Promise<LabAudioStatus> {
    if (this.disposed) return 'inactive'
    const token = ++this.generation
    this.armed = false
    // A suspended context must not replay an old queued note when unlocked.
    this.cancelTones()
    const browser = typeof window === 'undefined' ? null : window as AudioWindow
    const Audio = browser?.AudioContext ?? browser?.webkitAudioContext
    if (!Audio) return 'unsupported'
    try {
      const context = this.context && this.context.state !== 'closed' ? this.context : new Audio({ latencyHint: 'interactive' })
      this.context = context
      if (context.state !== 'running') await context.resume()
      if (this.disposed || token !== this.generation || context !== this.context) return 'inactive'
      this.armed = context.state === 'running'
      return this.armed ? 'ready' : 'blocked'
    } catch {
      if (this.disposed || token !== this.generation) return 'inactive'
      this.armed = false
      this.cancelTones()
      return 'blocked'
    }
  }

  /** Never creates/resumes a context: blocked audio remains a visible-only alert. */
  beep(): boolean {
    const context = this.context
    if (this.disposed || !this.armed || !context || context.state !== 'running') return false
    this.cancelTones()
    try {
      const now = context.currentTime
      // A short, quiet descending chime with a soft attack and release.
      for (const [index, frequency] of [659.25, 523.25].entries()) {
        const tone: Tone = { oscillator: context.createOscillator(), gain: null }
        this.tones.add(tone)
        tone.gain = context.createGain()
        const start = now + .01 + index * .25
        tone.oscillator.type = 'sine'
        tone.oscillator.frequency.setValueAtTime(frequency, start)
        tone.gain.gain.setValueAtTime(0, start)
        tone.gain.gain.linearRampToValueAtTime(.04, start + .025)
        tone.gain.gain.exponentialRampToValueAtTime(.001, start + .18)
        tone.gain.gain.linearRampToValueAtTime(0, start + .22)
        tone.oscillator.connect(tone.gain)
        tone.gain.connect(context.destination)
        tone.oscillator.onended = () => this.releaseTone(tone)
        tone.oscillator.start(start)
        tone.oscillator.stop(start + .24)
      }
      return true
    } catch {
      this.armed = false
      this.cancelTones()
      return false
    }
  }

  /** Stops queued sound and invalidates an unfinished gesture preparation. */
  cancel(): void {
    this.generation++
    this.armed = false
    this.cancelTones()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancel()
    const context = this.context
    this.context = null
    if (context && context.state !== 'closed') {
      try { void context.close().catch(() => {}) } catch { /* Already unavailable. */ }
    }
  }

  private releaseTone(tone: Tone) {
    if (!this.tones.delete(tone)) return
    tone.oscillator.onended = null
    try { tone.oscillator.disconnect() } catch { /* An interrupted node may already be detached. */ }
    try { tone.gain?.disconnect() } catch { /* An interrupted node may already be detached. */ }
  }

  private cancelTones() {
    const now = this.context?.currentTime ?? 0
    for (const tone of this.tones) {
      // Cancel both gain automation and scheduled sources, including a second note
      // whose future start time has not yet arrived.
      try { tone.gain?.gain.cancelScheduledValues(now); tone.gain?.gain.setValueAtTime(0, now) } catch { /* Context may be closed. */ }
      try { tone.oscillator.stop(now) } catch { /* A partially created node may not have started. */ }
      this.releaseTone(tone)
    }
  }
}
