import type { Landmark } from '../../../../../model/prototype/pose'

/**
 * `posture.frames.v1` (FE proposal 2.1, F1): what the app will send once BE's `ws` accepts
 * coordinate frames instead of feature deltas. Prepared 2026-10-13; not wired to a socket yet.
 *
 * - One message per 0.5 s interval `[start_ms, end_ms)`, times relative to the session start.
 * - Every frame inside, as captured (no averaging): 9 joints `[x, y, visibility]`, or `null`
 *   when nobody was tracked. Coordinates are MediaPipe's own (not mirrored, y grows down).
 * - `rest` (user pause) and `away` (camera lost) intervals carry no frames.
 * - `valid: false` marks a frame where the user's position cannot be determined (10/12
 *   meeting: shoulders out of view past the 2 s grace). Field name is the FE proposal; BE to
 *   confirm (FE proposal 2.1, unmeasurable-handling 0장).
 */
export const FRAME_SCHEMA_VERSION = '3.0'
export const FRAME_FEATURE_VERSION = 'keypoints-9-v1'
export const FRAME_INTERVAL_MS = 500
/** Nose, left/right eye, left/right ear, mouth left/right, left/right shoulder. */
export const FRAME_JOINTS = [0, 2, 5, 7, 8, 9, 10, 11, 12] as const

export type FramePhase = 'running' | 'calibration' | 'rest' | 'away'
export type PoseFrame = { t_ms: number; p: [number, number, number][] | null; valid?: false }
export type FrameBatch = {
  schema_version: typeof FRAME_SCHEMA_VERSION
  feature_version: typeof FRAME_FEATURE_VERSION
  sequence: number
  start_ms: number
  end_ms: number
  phase: FramePhase
  frames: PoseFrame[]
}

export type FrameInput = {
  /** Same clock as `origin` (performance.now()). */
  timeMs: number
  landmarks: Landmark[]
  /** False when the app could not determine the user's position (shoulders gone past grace). */
  judgeable: boolean
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits

export function frameJoints(landmarks: Landmark[]): [number, number, number][] | null {
  if (!landmarks.length) return null
  return FRAME_JOINTS.map((i) => {
    const p = landmarks[i]
    return p ? [round(p.x, 5), round(p.y, 5), round(p.visibility ?? 0, 2)] : [0, 0, 0]
  })
}

/** Collects observations into 0.5 s `posture.frames.v1` messages with increasing sequence. */
export class FrameBatcher {
  private sequence = 0
  private start = 0
  private phase: FramePhase
  private frames: PoseFrame[] = []

  constructor(
    /** Session start on the observation clock; `t_ms` 0. */
    private readonly origin: number,
    phase: FramePhase = 'running',
    private readonly intervalMs = FRAME_INTERVAL_MS,
  ) {
    this.phase = phase
  }

  private at(timeMs: number) {
    return Math.max(0, Math.round(timeMs - this.origin))
  }

  /** Adds one observation; frames are kept only while running or registering. */
  push(input: FrameInput): FrameBatch[] {
    const out = this.tick(input.timeMs)
    if (this.phase === 'rest' || this.phase === 'away') return out
    const frame: PoseFrame = { t_ms: this.at(input.timeMs), p: frameJoints(input.landmarks) }
    if (!input.judgeable && frame.p) frame.valid = false
    this.frames.push(frame)
    return out
  }

  /** Emits every interval that ended by `timeMs` (empty intervals included, so time stays continuous). */
  tick(timeMs: number): FrameBatch[] {
    const out: FrameBatch[] = []
    while (this.at(timeMs) - this.start >= this.intervalMs) out.push(this.close(this.start + this.intervalMs))
    return out
  }

  /**
   * Pause, camera loss, resume or registration: the open interval ends at the change, so the
   * server sees the exact time (FE proposal 2.2: `t_ms` as is, the server aligns to 0.5 s).
   */
  setPhase(phase: FramePhase, timeMs: number): FrameBatch[] {
    if (phase === this.phase) return this.tick(timeMs)
    const out = this.tick(timeMs)
    const now = this.at(timeMs)
    if (now > this.start) out.push(this.close(now))
    this.phase = phase
    return out
  }

  /** Closes the last partial interval at `timeMs` (before WebSocket `end`). */
  finish(timeMs: number): FrameBatch[] {
    const out = this.tick(timeMs)
    const now = this.at(timeMs)
    if (now > this.start) out.push(this.close(now))
    return out
  }

  private close(end: number): FrameBatch {
    const batch: FrameBatch = {
      schema_version: FRAME_SCHEMA_VERSION,
      feature_version: FRAME_FEATURE_VERSION,
      sequence: this.sequence++,
      start_ms: this.start,
      end_ms: end,
      phase: this.phase,
      frames: this.phase === 'rest' || this.phase === 'away' ? [] : this.frames.filter((f) => f.t_ms < end),
    }
    this.frames = this.frames.filter((f) => f.t_ms >= end)
    this.start = end
    return batch
  }
}
