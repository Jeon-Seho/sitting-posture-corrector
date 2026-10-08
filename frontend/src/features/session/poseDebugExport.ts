import { referenceScore, type Features, type Landmark } from '../../../../model/prototype/pose'

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
  'features_ok',
  'state',
  'type',
  'score',
  ...DEBUG_POINTS.flatMap(([name]) => [`${name}_x`, `${name}_y`]),
]

type Frame = {
  timeMs: number
  width: number
  height: number
  features: Features | null
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
 * The app's own per-frame rule judgement, written as the label column set:
 * state g (good) / c (collapse) / u (unmeasurable), type h (head/upper body) / t (tilt),
 * blank unless collapsed, and the 0..1 rule score. Same rule as the live screen
 * (referenceScore against the session threshold), before the hold-time confirmation.
 * It is our rule's output, not a human-checked ground truth.
 */
function judgement(features: Features | null, baseline: Features, threshold: number) {
  const result = features ? referenceScore(features, baseline) : null
  if (!result || result.score === null) return ['u', '', '']
  const collapsed = result.score >= threshold
  return [collapsed ? 'c' : 'g', collapsed ? (result.tilt ? 't' : 'h') : '', floor2(result.score)]
}

/**
 * Truncates (never rounds up) so a good frame just under the threshold never reads as
 * the threshold itself, e.g. 0.6996 is 0.69, not 0.70. The epsilon absorbs float error
 * such as 0.29 * 100 = 28.999…
 */
const floor2 = (score: number) => (Math.floor(score * 100 + 1e-9) / 100).toFixed(2)

/**
 * Raw (unsmoothed) landmarks per running frame, for offline analysis of head turn,
 * slouch and shoulder signals, with the rule judgement of the same frame.
 * Analysis only: nothing here feeds the judgement.
 * width/height (video pixels, needed to undo the 0..1 aspect ratio) do not change within
 * a session, so only the first row carries them.
 */
export class PoseDebugRecorder {
  private readonly rows: string[] = []
  truncated = false

  constructor(
    private readonly origin: number,
    private readonly baseline: Features,
    private readonly threshold: number,
  ) {}

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
        frame.features !== null ? '1' : '0',
        ...judgement(frame.features, this.baseline, this.threshold),
        ...image,
      ].join(','),
    )
  }

  toCsv() {
    return [HEADER.join(','), ...this.rows].join('\n') + '\n'
  }
}
