import type { Landmark } from '../../../../../model/prototype/pose'

/**
 * `posture.frames.v1` (FE proposal 3.1, F1): what the app sends to `/v2/realtime` (LiveSession,
 * 2026-10-21).
 *
 * - One message per frame (2026-10-27, team lead): the interval `[start_ms, end_ms)` holds one
 *   frame and ends when the next frame arrives, so the server judges every frame on its own
 *   (no 0.5 s averaging). Times are relative to the session start. With no new frame for
 *   0.5 s the interval still closes at 0.5 s, so time stays continuous.
 * - The frame as captured: 9 joints `[x, y, visibility]`, or `null` when nobody was tracked.
 *   Coordinates are MediaPipe's own (not mirrored, y grows down).
 * - `rest` (user pause) and `away` (camera lost) intervals carry no frames.
 * - A frame where the user's position cannot be determined (a shoulder out of view, or a joint the
 *   tracker did not give) is sent as the signal only: `{ t_ms, p: null, valid: false }`, no
 *   coordinates (ADR 0032, 2026-10-27; before, ADR 0021's 10/12 exception sent them along). The
 *   server counts it as unmeasurable time.
 */
export const FRAME_SCHEMA_VERSION = '3.0'
export const FRAME_FEATURE_VERSION = 'keypoints-9-v1'
/** Longest interval: closes without a new frame so the server's clock never stalls. */
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
  /** False when the app could not determine the user's position (a shoulder out of view). */
  judgeable: boolean
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/**
 * The 9 joints as `[x, y, visibility]`. The server rejects the whole interval (and closes the
 * measurement with `bad_message`) for a joint outside x·y -1..2 or visibility 0..1 (BE
 * `FrameInterval`), so values are clamped to that range; a joint the tracker did not give, or
 * gave as a non-number, is `[0, 0, 0]` (visibility 0). Such a frame is not sent with coordinates
 * at all: `FrameBatcher.push` sends it as the 「판정 불가」 signal only (ADR 0032).
 */
/** All 9 joints came from the tracker as numbers (nothing was filled in with `[0, 0, 0]`). */
export function jointsComplete(landmarks: Landmark[]): boolean {
  return FRAME_JOINTS.every((i) => {
    const p = landmarks[i]
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
  })
}

export function frameJoints(landmarks: Landmark[]): [number, number, number][] | null {
  if (!landmarks.length) return null
  return FRAME_JOINTS.map((i) => {
    const p = landmarks[i]
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return [0, 0, 0]
    const visibility = Number.isFinite(p.visibility) ? p.visibility! : 0
    return [round(clamp(p.x, -1, 2), 5), round(clamp(p.y, -1, 2), 5), round(clamp(visibility, 0, 1), 2)]
  })
}

/** Turns observations into one-frame `posture.frames.v1` messages with increasing sequence. */
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

  /**
   * Adds one observation; frames are kept only while running or registering. The open interval,
   * holding the previous frame, ends at this frame's time and is sent now.
   */
  push(input: FrameInput): FrameBatch[] {
    const out = this.tick(input.timeMs)
    if (this.phase === 'rest' || this.phase === 'away') return out
    const joints = frameJoints(input.landmarks)
    // Not placeable (a shoulder out of view) or a joint missing: the 「판정 불가」 signal only, no
    // coordinates — a frame with a missing keypoint is no use for judging or for training (ADR 0032).
    const frame: PoseFrame =
      joints && (!input.judgeable || !jointsComplete(input.landmarks))
        ? { t_ms: this.at(input.timeMs), p: null, valid: false }
        : { t_ms: this.at(input.timeMs), p: joints }
    if (this.frames.length && frame.t_ms > this.start) out.push(this.close(frame.t_ms))
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
