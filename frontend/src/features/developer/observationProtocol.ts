export const OBSERVATION_REFERENCE_MS = 8000
import type { ComparisonAction } from './comparisonDemo'

/** Base → deviation → base → seated stretch. Labels are guided tasks, never verified movement. */
export const OBSERVATION_PROTOCOL = {
  id: 'front-observation-deviation-stretch-v4',
  actions: ['deviation', 'stretch'],
  roundOptions: [1, 3],
  moveMs: 2000,
  holdMs: { deviation: 5000, stretch: 8000 },
  returnMs: 5000,
  gapMs: 500,
} as const
export type GuidedPhase = 'move' | 'hold' | 'return'
export type GuideMode = 'auto' | 'manual'
export type GuidePlan = { rounds: typeof OBSERVATION_PROTOCOL.roundOptions[number]; shuffle: boolean }
export const DEFAULT_GUIDE_PLAN: GuidePlan = { rounds: 1, shuffle: true }
export type GuidePauseReason = 'user' | 'hidden' | 'tracking_lost' | 'clock_gap'
export type GuidedStep = { round: number; trial: number; action: Exclude<ComparisonAction, 'neutral'>; phase: GuidedPhase; durationMs: number }
export type GuideSnapshot = {
  status: 'idle' | 'running' | 'waiting' | 'paused' | 'completed' | 'cancelled'
  mode: GuideMode
  runId: string; step: GuidedStep | null; stepIndex: number; attempt: number
  elapsedMs: number; remainingMs: number; pauseReason: GuidePauseReason | null
  plan: GuidePlan; stepCount: number; next: GuidedStep | null
}

/** Each round guides both actions once; shuffle only changes the order inside a round. */
export function observationSteps(plan: GuidePlan = DEFAULT_GUIDE_PLAN, random: () => number = Math.random): GuidedStep[] {
  return Array.from({ length: plan.rounds }, (_, round) => {
    const actions = [...OBSERVATION_PROTOCOL.actions]
    if (plan.shuffle && random() < 0.5) actions.reverse()
    return actions.flatMap((action, i) => ([['move', OBSERVATION_PROTOCOL.moveMs], ['hold', OBSERVATION_PROTOCOL.holdMs[action]], ['return', OBSERVATION_PROTOCOL.returnMs]] as const)
      .map(([phase, durationMs]) => ({ round: round + 1, trial: round * actions.length + i + 1, action, phase, durationMs })))
  }).flat()
}

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
  private mode: GuideMode = 'auto'
  private plan: GuidePlan = DEFAULT_GUIDE_PLAN
  private steps: readonly GuidedStep[] = observationSteps({ ...DEFAULT_GUIDE_PLAN, shuffle: false })

  snapshot(now: number): GuideSnapshot {
    const base = this.status === 'idle' ? null : this.steps[this.index]
    const step = base && this.mode === 'manual' && base.phase === 'move' ? { ...base, durationMs: 0 } : base
    const elapsedMs = Math.max(0, Math.min(step?.durationMs ?? 0, this.status === 'running' ? now - this.started : this.frozen))
    const next = this.steps[this.status === 'idle' ? 0 : this.index + 1] ?? null
    return { status: this.status, mode: this.mode, runId: this.runId, step, stepIndex: this.index, attempt: this.attempt, elapsedMs, remainingMs: (step?.durationMs ?? 0) - elapsedMs, pauseReason: this.reason,
      plan: this.plan, stepCount: this.steps.length, next }
  }
  start(now: number, runId: string, mode: GuideMode = 'auto', plan: GuidePlan = { ...DEFAULT_GUIDE_PLAN, shuffle: false }, random: () => number = Math.random) {
    if (!Number.isFinite(now) || this.status === 'running' || this.status === 'paused' || this.status === 'waiting') return false
    if (!OBSERVATION_PROTOCOL.roundOptions.includes(plan.rounds)) return false
    this.mode = mode; this.plan = { ...plan }; this.steps = observationSteps(this.plan, random)
    this.status = mode === 'manual' ? 'waiting' : 'running'; this.runId = runId; this.index = 0; this.attempt = 1
    this.started = this.last = now; this.frozen = 0; this.reason = null
    return true
  }
  advance(now: number): 'none' | 'phase' | 'completed' | 'paused' | 'waiting' {
    if (this.status !== 'running') return 'none'
    if (!Number.isFinite(now) || now < this.last || now - this.last > OBSERVATION_PROTOCOL.gapMs) {
      this.pause('clock_gap'); return 'paused'
    }
    this.last = now
    if (now - this.started < this.steps[this.index].durationMs) return 'none'
    if (this.mode === 'manual') {
      this.frozen = this.steps[this.index].durationMs; this.status = 'waiting'; return 'waiting'
    }
    return this.transition(now)
  }
  next(now: number): 'none' | 'phase' | 'completed' {
    if (this.status !== 'waiting' || !Number.isFinite(now) || now <= this.last) return 'none'
    this.last = now
    return this.transition(now)
  }
  private transition(now: number): 'phase' | 'completed' {
    if (this.index === this.steps.length - 1) {
      this.frozen = this.steps[this.index].durationMs; this.status = 'completed'; return 'completed'
    }
    // Each instruction receives its full visible time, even after a delayed callback.
    this.index++; this.status = this.mode === 'manual' && this.steps[this.index].phase === 'move' ? 'waiting' : 'running'; this.attempt = 1; this.started = this.last = now; this.frozen = 0
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
    if (this.status !== 'running' && this.status !== 'paused' && this.status !== 'waiting') return false
    this.frozen = this.snapshot(now).elapsedMs; this.status = 'cancelled'
    return true
  }
}
