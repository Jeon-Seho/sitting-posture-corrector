import type { ComparisonAction } from './comparisonDemo'

export const OBSERVATION_PROTOCOL = {
  id: 'front-observation-2-5-5x3-v1',
  rounds: 3,
  actions: ['head', 'bow', 'body', 'shoulders'],
  phases: [{ id: 'move', durationMs: 2000 }, { id: 'hold', durationMs: 5000 }, { id: 'return', durationMs: 5000 }],
  gapMs: 500,
} as const
export type GuidedPhase = typeof OBSERVATION_PROTOCOL.phases[number]['id']
export type GuidePauseReason = 'user' | 'hidden' | 'tracking_lost' | 'clock_gap'
export type GuidedStep = { round: number; trial: number; action: Exclude<ComparisonAction, 'neutral'>; phase: GuidedPhase; durationMs: number }
export type GuideSnapshot = {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled'
  runId: string; step: GuidedStep | null; stepIndex: number; attempt: number
  elapsedMs: number; remainingMs: number; pauseReason: GuidePauseReason | null
}
export const OBSERVATION_STEPS: readonly GuidedStep[] = Array.from({ length: OBSERVATION_PROTOCOL.rounds }, (_, round) =>
  OBSERVATION_PROTOCOL.actions.flatMap((action, i) => OBSERVATION_PROTOCOL.phases.map(phase => ({
    round: round + 1, trial: round * OBSERVATION_PROTOCOL.actions.length + i + 1, action, phase: phase.id, durationMs: phase.durationMs,
  }))),
).flat()

/** Guides requested tasks; it does not infer or verify a person's movement. */
export class ObservationProtocol {
  private status: GuideSnapshot['status'] = 'idle'
  private runId = ''
  private index = 0
  private attempt = 1
  private started = 0
  private last = 0
  private frozen = 0
  private reason: GuidePauseReason | null = null

  snapshot(now: number): GuideSnapshot {
    const step = this.status === 'idle' ? null : OBSERVATION_STEPS[this.index]
    const elapsedMs = Math.max(0, Math.min(step?.durationMs ?? 0, this.status === 'running' ? now - this.started : this.frozen))
    return { status: this.status, runId: this.runId, step, stepIndex: this.index, attempt: this.attempt, elapsedMs, remainingMs: (step?.durationMs ?? 0) - elapsedMs, pauseReason: this.reason }
  }
  start(now: number, runId: string) {
    if (!Number.isFinite(now) || this.status === 'running' || this.status === 'paused') return false
    this.status = 'running'; this.runId = runId; this.index = 0; this.attempt = 1
    this.started = this.last = now; this.frozen = 0; this.reason = null
    return true
  }
  advance(now: number): 'none' | 'phase' | 'completed' | 'paused' {
    if (this.status !== 'running') return 'none'
    if (!Number.isFinite(now) || now < this.last || now - this.last > OBSERVATION_PROTOCOL.gapMs) {
      this.pause('clock_gap'); return 'paused'
    }
    this.last = now
    if (now - this.started < OBSERVATION_STEPS[this.index].durationMs) return 'none'
    if (this.index === OBSERVATION_STEPS.length - 1) {
      this.frozen = OBSERVATION_STEPS[this.index].durationMs; this.status = 'completed'; return 'completed'
    }
    // Each instruction receives its full visible time, even after a delayed callback.
    this.index++; this.attempt = 1; this.started = now; this.frozen = 0
    return 'phase'
  }
  pause(reason: GuidePauseReason) {
    if (this.status !== 'running') return false
    this.frozen = this.snapshot(this.last).elapsedMs; this.status = 'paused'; this.reason = reason
    return true
  }
  resume(now: number) {
    if (this.status !== 'paused' || !Number.isFinite(now)) return false
    this.status = 'running'; this.attempt++; this.started = this.last = now; this.frozen = 0; this.reason = null
    return true
  }
  cancel(now: number) {
    if (this.status !== 'running' && this.status !== 'paused') return false
    this.frozen = this.snapshot(now).elapsedMs; this.status = 'cancelled'
    return true
  }
}
