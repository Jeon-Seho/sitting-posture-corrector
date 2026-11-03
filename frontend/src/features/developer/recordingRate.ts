/**
 * /dev keeps 7–10 Hz of the tracking output. A frame is kept once it reaches the next 100 ms slot.
 * Slots advance on their own schedule, not from the last kept frame, so a ~13 fps tracker keeps
 * about 10 Hz instead of every second frame (6.7 Hz). Kept frames are at least 50 ms apart.
 * Below `minimumHz` over the last `windowMs` the screen warns; recording itself continues.
 */
export const RECORDING_RATE = { maximumHz: 10, minimumHz: 7, slotMs: 100, windowMs: 3000, minimumSpanMs: 2000 } as const

export class RecordingSlots {
  private due: number | null = null
  reset() { this.due = null }
  keep(previousMs: number | null, timeMs: number) {
    // A non-increasing time goes through; the comparison engine reports it as interrupted.
    if (previousMs !== null && !(timeMs > previousMs)) return true
    if (this.due !== null && timeMs < this.due) return false
    this.due = Math.max((this.due ?? timeMs) + RECORDING_RATE.slotMs, timeMs + RECORDING_RATE.slotMs / 2)
    return true
  }
}

/** Kept frames per second over the recent window; null until the window spans `minimumSpanMs`. */
export class RecordingRate {
  private times: number[] = []
  reset() { this.times = [] }
  add(timeMs: number) {
    if (!Number.isFinite(timeMs) || this.times.length && timeMs <= this.times.at(-1)!) return
    this.times.push(timeMs)
    while (timeMs - this.times[0] > RECORDING_RATE.windowMs) this.times.shift()
  }
  hz(): number | null {
    const span = this.times.length > 1 ? this.times.at(-1)! - this.times[0] : 0
    return span >= RECORDING_RATE.minimumSpanMs ? (this.times.length - 1) * 1000 / span : null
  }
}
