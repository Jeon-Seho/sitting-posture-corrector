import type { Landmark } from '../../../../model/prototype/pose'

/** MediaPipe Pose indices kept for analysis: nose, eyes, ears, mouth corners, shoulders. */
export const DEBUG_POINTS = [
  ['nose', 0],
  ['left_eye', 2],
  ['right_eye', 5],
  ['left_ear', 7],
  ['right_ear', 8],
  ['mouth_left', 9],
  ['mouth_right', 10],
  ['left_shoulder', 11],
  ['right_shoulder', 12],
] as const

/** Same cap as the Kafka-format export: about one hour at 30 fps. */
export const MAX_DEBUG_FRAMES = 108_000

const HEADER = [
  'time_ms',
  'width',
  'height',
  ...DEBUG_POINTS.flatMap(([name]) => [`${name}_x`, `${name}_y`]),
]

type Frame = {
  timeMs: number
  width: number
  height: number
  landmarks: Landmark[]
}

/**
 * Image x/y only, normalised to the frame (0..1), at 5 decimals (about 0.006 px at
 * 640 wide, well under the ~0.005 frame-to-frame noise). Depth (z), visibility and
 * world (metre) coordinates were never used in the analysis, so they are not kept.
 */
const COORD_DECIMALS = 5
const num = (value: number | undefined) =>
  Number.isFinite(value) ? String(Number((value as number).toFixed(COORD_DECIMALS))) : ''

/**
 * Raw (unsmoothed) landmarks per running frame, for offline analysis.
 * The app writes no judgement labels (ADR 0021); labels come from the server and ML.
 * width/height (video pixels, needed to undo the 0..1 aspect ratio) do not change within
 * a session, so only the first row carries them.
 */
export class PoseDebugRecorder {
  private readonly rows: string[] = []
  truncated = false

  constructor(private readonly origin: number) {}

  get count() {
    return this.rows.length
  }

  push(frame: Frame) {
    if (!Number.isFinite(frame.timeMs) || frame.timeMs < this.origin) return
    if (this.rows.length >= MAX_DEBUG_FRAMES) {
      this.truncated = true
      return
    }
    const image = DEBUG_POINTS.flatMap(([, i]) => {
      const p = frame.landmarks[i]
      return [num(p?.x), num(p?.y)]
    })
    const first = this.rows.length === 0
    this.rows.push(
      [
        String(Math.round(frame.timeMs - this.origin)),
        first ? String(frame.width) : '',
        first ? String(frame.height) : '',
        ...image,
      ].join(','),
    )
  }

  toCsv() {
    return [HEADER.join(','), ...this.rows].join('\n') + '\n'
  }
}
