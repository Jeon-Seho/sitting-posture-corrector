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
  'features_ok',
  ...DEBUG_POINTS.flatMap(([name]) => [`${name}_x`, `${name}_y`, `${name}_z`, `${name}_v`]),
  ...DEBUG_POINTS.flatMap(([name]) => [`${name}_wx`, `${name}_wy`, `${name}_wz`]),
]

type Frame = {
  timeMs: number
  width: number
  height: number
  featuresOk: boolean
  landmarks: Landmark[]
  worldLandmarks: Landmark[]
}

const num = (value: number | undefined) => (Number.isFinite(value) ? String(value) : '')

/**
 * Raw (unsmoothed) landmarks per running frame, for offline analysis of head turn,
 * slouch and shoulder signals. Analysis only: nothing here feeds the judgement.
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
      return [num(p?.x), num(p?.y), num(p?.z), num(p?.visibility)]
    })
    const world = DEBUG_POINTS.flatMap(([, i]) => {
      const p = frame.worldLandmarks[i]
      return [num(p?.x), num(p?.y), num(p?.z)]
    })
    this.rows.push(
      [
        String(Math.round(frame.timeMs - this.origin)),
        String(frame.width),
        String(frame.height),
        frame.featuresOk ? '1' : '0',
        ...image,
        ...world,
      ].join(','),
    )
  }

  toCsv() {
    return [HEADER.join(','), ...this.rows].join('\n') + '\n'
  }
}
