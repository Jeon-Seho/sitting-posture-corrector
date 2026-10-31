export const OBSERVATION_REFERENCE_MS = 8000
import type { ComparisonAction } from './comparisonDemo'

/** Each task is followed by a measured base hold. Labels are guided tasks, never verified movement. */
export const OBSERVATION_PROTOCOL = {
  id: 'front-observation-base-hold-v7',
  actions: ['deviation', 'stretch'],
  roundOptions: [1, 2, 3, 4, 5],
  moveMs: 2000,
  /** Whole seconds, drawn once per task and shared by the task hold and the base hold after it. */
  holdSeconds: { min: 8, max: 15 },
  returnMs: 3000,
  gapMs: 500,
} as const
export type GuidedPhase = 'move' | 'hold' | 'return'
export type GuideMode = 'auto' | 'manual'
export type GuidePlan = { rounds: typeof OBSERVATION_PROTOCOL.roundOptions[number]; shuffle: boolean; cycle?: 'repeat' | 'stretch'; stretchNote?: string }
export const DEFAULT_GUIDE_PLAN: GuidePlan = { rounds: 1, shuffle: false, cycle: 'repeat', stretchNote: '' }
export type GuidePauseReason = 'user' | 'hidden' | 'tracking_lost' | 'clock_gap'
export type GuidedStep = { round: number; trial: number; action: ComparisonAction; phase: GuidedPhase; durationMs: number }
export type GuideSnapshot = {
  status: 'idle' | 'running' | 'waiting' | 'note' | 'paused' | 'completed' | 'cancelled'
  mode: GuideMode
  runId: string; step: GuidedStep | null; stepIndex: number; attempt: number
  elapsedMs: number; remainingMs: number; pauseReason: GuidePauseReason | null
  plan: GuidePlan; stepCount: number; next: GuidedStep | null
}

export function randomHoldMs(random: () => number = Math.random) {
  const { min, max } = OBSERVATION_PROTOCOL.holdSeconds
  return Math.min(max, min + Math.floor(random() * (max - min + 1))) * 1000
}

/** Each round has two tasks. Each task is followed by a return and a measured base hold of the same length. */
export function observationSteps(plan: GuidePlan = DEFAULT_GUIDE_PLAN, random: () => number = Math.random): GuidedStep[] {
  return Array.from({ length: plan.rounds }, (_, round) => {
    const actions: Array<'deviation' | 'stretch'> = plan.cycle === 'stretch' ? ['deviation', 'stretch'] : ['deviation', 'deviation']
    return actions.flatMap((action, i) => {
      const holdMs = randomHoldMs(random), trial = round * actions.length + i + 1
      return ([[action, 'move', OBSERVATION_PROTOCOL.moveMs], [action, 'hold', holdMs], [action, 'return', OBSERVATION_PROTOCOL.returnMs], ['neutral', 'hold', holdMs]] as const)
        .map(([stepAction, phase, durationMs]) => ({ round: round + 1, trial, action: stepAction, phase, durationMs }))
    })
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

  /** The drawn schedule of the current run, so a recording can keep each phase's length. */
  schedule(): GuidedStep[] { return this.steps.map(step => ({ ...step })) }

  snapshot(now: number): GuideSnapshot {
    const base = this.status === 'idle' ? null : this.steps[this.index]
    const step = base && this.mode === 'manual' && base.phase === 'move' ? { ...base, durationMs: 0 } : base
    const elapsedMs = Math.max(0, Math.min(step?.durationMs ?? 0, this.status === 'running' ? now - this.started : this.frozen))
    const next = this.steps[this.status === 'idle' ? 0 : this.index + 1] ?? null
    return { status: this.status, mode: this.mode, runId: this.runId, step, stepIndex: this.index, attempt: this.attempt, elapsedMs, remainingMs: (step?.durationMs ?? 0) - elapsedMs, pauseReason: this.reason,
      plan: this.plan, stepCount: this.steps.length, next }
  }
  start(now: number, runId: string, mode: GuideMode = 'auto', plan: GuidePlan = { ...DEFAULT_GUIDE_PLAN, shuffle: false }, random: () => number = Math.random) {
    if (!Number.isFinite(now) || this.status === 'running' || this.status === 'paused' || this.status === 'waiting' || this.status === 'note') return false
    if (!OBSERVATION_PROTOCOL.roundOptions.includes(plan.rounds) || (plan.cycle !== undefined && !['repeat', 'stretch'].includes(plan.cycle)) || (plan.stretchNote !== undefined && (typeof plan.stretchNote !== 'string' || plan.stretchNote.length > 120))) return false
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
    this.index++; const step = this.steps[this.index]; this.status = step.action === 'stretch' && step.phase === 'move' ? 'note' : this.mode === 'manual' && step.phase === 'move' ? 'waiting' : 'running'; this.attempt = 1; this.started = this.last = now; this.frozen = 0
    return 'phase'
  }
  finishNote(now: number) {
    if (this.status !== 'note' || !Number.isFinite(now) || now < this.last) return false
    this.status = this.mode === 'manual' ? 'waiting' : 'running'; this.started = this.last = now; this.frozen = 0
    return true
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
    if (this.status !== 'running' && this.status !== 'paused' && this.status !== 'waiting' && this.status !== 'note') return false
    this.frozen = this.snapshot(now).elapsedMs; this.status = 'cancelled'
    return true
  }
}
