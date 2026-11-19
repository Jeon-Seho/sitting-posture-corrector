import type { Landmark } from '../../../../../model/prototype/pose'

/**
 * The `features` message the app sends to `/realtime` (team lead's flattened contract draft,
 * 2026-11-18 review request; FE reply 2026-11-19).
 *
 * - One interval per message, holding at most one frame: `[start_ms, end_ms)` ends when the next
 *   frame arrives, or after 0.5 s without one, so the server's clock never stalls. Times are
 *   relative to the session start.
 * - `running`: a frame where the user's position is known (both shoulders seen) — `t_ms` and the
 *   9 joints `[x, y, visibility]` as captured (MediaPipe's own, not mirrored, y grows down).
 * - `unmeasurable`: a frame the app could not place (a shoulder out of view, nobody, a joint the
 *   tracker did not give) — `t_ms` and `p: null`; or no new frame in the interval — `p: null`,
 *   no `t_ms`. Partial coordinates are never filled in and sent as `running` (ADR 0021).
 * - `rest` (user pause) and `away` (camera stopped) carry neither `t_ms` nor `p`.
 * - Head turns are not filtered here: the server scores them and ML tells them apart (11/19).
 * - No `schema_version`·`feature_version`·`valid`: contract versions are not used (FE reply 3).
 * - Two frames with the same time keep the later one; a frame older than the open interval (that
 *   time was already closed on the clock while tracking lagged) is dropped.
 */
/** Longest interval: closes without a new frame so the server's clock never stalls. */
export const FRAME_INTERVAL_MS = 500
/** Nose, left/right eye, left/right ear, mouth left/right, left/right shoulder. */
export const FRAME_JOINTS = [0, 2, 5, 7, 8, 9, 10, 11, 12] as const

/** What the app is doing: measuring, the user's pause, or the camera stopped. */
export type FramePhase = 'running' | 'rest' | 'away'
export type Joints = [number, number, number][]
type PoseFrame = { t_ms: number; p: Joints | null }
/** One `features` message without its `type` (the socket adds it). */
export type FrameBatch = {
  sequence: number
  start_ms: number
  end_ms: number
  phase: FramePhase | 'unmeasurable'
  t_ms?: number
  p?: Joints | null
}

export type FrameInput = {
  /** Same clock as `origin` (performance.now()). */
  timeMs: number
  landmarks: Landmark[]
  /** False when the app could not determine the user's position (a shoulder out of view). */
  judgeable: boolean
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** All 9 joints came from the tracker as numbers (nothing was filled in with `[0, 0, 0]`). */
export function jointsComplete(landmarks: Landmark[]): boolean {
  return FRAME_JOINTS.every((i) => {
    const p = landmarks[i]
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
  })
}

/**
 * The 9 joints as `[x, y, visibility]`. The server rejects a joint outside x·y -1..2 or
 * visibility 0..1, so values are clamped to that range; a joint the tracker did not give, or gave
 * as a non-number, is `[0, 0, 0]` (visibility 0). Such a frame is not sent with coordinates at
 * all: `FrameBatcher.push` sends it as `unmeasurable` (ADR 0021).
 */
export function frameJoints(landmarks: Landmark[]): Joints | null {
  if (!landmarks.length) return null
  return FRAME_JOINTS.map((i) => {
    const p = landmarks[i]
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return [0, 0, 0]
    const visibility = Number.isFinite(p.visibility) ? p.visibility! : 0
    return [round(clamp(p.x, -1, 2), 5), round(clamp(p.y, -1, 2), 5), round(clamp(visibility, 0, 1), 2)]
  })
}

/** Turns observations into one-frame `features` messages with increasing sequence. */
export class FrameBatcher {
  private sequence = 0
  private start = 0
  private phase: FramePhase
  private frame: PoseFrame | null = null

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

  /**
   * Adds one observation; frames are kept only while running. The open interval, holding the
   * previous frame, ends at this frame's time and is sent now.
   */
  push(input: FrameInput): FrameBatch[] {
    const out = this.tick(input.timeMs)
    if (this.phase === 'rest' || this.phase === 'away') return out
    const t = this.at(input.timeMs)
    // Older than the open interval: that time was already sent.
    if (t < this.start) return out
    const joints = frameJoints(input.landmarks)
    const frame: PoseFrame = {
      t_ms: t,
      p: joints && input.judgeable && jointsComplete(input.landmarks) ? joints : null,
    }
    if (this.frame && t > this.start) out.push(this.close(t))
    // One frame per interval: a second frame at the interval's start time replaces the first.
    this.frame = frame
    return out
  }

  /** Emits every interval that ended by `timeMs` (empty intervals included, so time stays continuous). */
  tick(timeMs: number): FrameBatch[] {
    const out: FrameBatch[] = []
    while (this.at(timeMs) - this.start >= this.intervalMs) out.push(this.close(this.start + this.intervalMs))
    return out
  }

  /**
   * Pause, camera loss or resume: the open interval ends at the change, so the server sees the
   * exact time (FE proposal 2.2: `t_ms` as is, the server aligns to 0.5 s).
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
    const head = { sequence: this.sequence++, start_ms: this.start, end_ms: end }
    const frame = this.frame && this.frame.t_ms < end ? this.frame : null
    if (frame) this.frame = null
    this.start = end
    if (this.phase === 'rest' || this.phase === 'away') return { ...head, phase: this.phase }
    if (!frame) return { ...head, phase: 'unmeasurable', p: null }
    return frame.p
      ? { ...head, phase: 'running', t_ms: frame.t_ms, p: frame.p }
      : { ...head, phase: 'unmeasurable', t_ms: frame.t_ms, p: null }
  }
}
