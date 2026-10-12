import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  features,
  headTurned,
  HEAD_TURN_LIMIT,
  referenceScore,
  SHOULDER_TILT_SCALE,
  type Features,
  type Landmark,
} from '../../../../../model/prototype/pose'
import { featureDeltas } from '../../../../../model/prototype/serverFeatures'
import {
  CALIBRATION_MIN_SAMPLES,
  CALIBRATION_MS,
  beginCalibration,
  observeCalibration,
} from '../../../../../model/prototype/calibration'
import { ReturnSettle, RETURN_SETTLE_MS, TURN_SETTLE_MS, type Observed } from '../../../lib/returnSettle'

/**
 * Shared synthetic cases for moving the app's judgement rules to the server (plan 0023, step 1).
 * The JSON is generated from the app code below; `UPDATE_RULE_CASES=1 npx vitest run referenceRuleCases`
 * rewrites it. Every other run checks that the file still matches the code.
 */
const FILE = new URL('../../../../../contracts/examples/frames/reference-rule-cases.json', import.meta.url)

const WIDTH = 640
const HEIGHT = 480
/** MediaPipe Pose indices in `posture.frames.v1` order (FE reply to the v4 meeting, item 2). */
const JOINTS = [0, 2, 5, 7, 8, 9, 10, 11, 12] as const
const JOINT_NAMES = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'mouth_left',
  'mouth_right',
  'left_shoulder',
  'right_shoulder',
] as const
/** Frame gap above which the server controller pauses instead of sending an interval. */
const FRAME_EXPIRY_MS = 1000

type Point = [number, number, number]
type Frame = Point[] | null

const BASELINE: Point[] = [
  [0.5, 0.4, 0.99],
  [0.52, 0.38, 0.99],
  [0.48, 0.38, 0.99],
  [0.54, 0.4, 0.9],
  [0.46, 0.4, 0.9],
  [0.51, 0.43, 0.99],
  [0.49, 0.43, 0.99],
  [0.6, 0.6, 0.99],
  [0.4, 0.6, 0.99],
]

const joint = (name: (typeof JOINT_NAMES)[number]) => JOINT_NAMES.indexOf(name)

/** Copy the baseline and change some joints: `{ nose: [dx, dy] }` or `{ nose: [dx, dy, visibility] }`. */
function pose(changes: Partial<Record<(typeof JOINT_NAMES)[number], number[]>>): Point[] {
  const p = BASELINE.map((point) => [...point] as Point)
  for (const [name, [dx, dy, visibility]] of Object.entries(changes)) {
    const i = joint(name as (typeof JOINT_NAMES)[number])
    p[i] = [p[i][0] + dx, p[i][1] + dy, visibility ?? p[i][2]]
  }
  return p
}

function landmarks(frame: Frame): Landmark[] {
  const points: Landmark[] = []
  frame?.forEach(([x, y, visibility], i) => (points[JOINTS[i]] = { x, y, z: 0, visibility }))
  return points
}

const named = (f: Features | null) =>
  f && {
    head_gap: f.headGap,
    lateral_offset: f.offset,
    shoulder_tilt: f.tilt,
    quality: f.quality,
    head_turn_offset: f.turn ?? 0,
  }

const FRAME_CASES: { name: string; note: string; p: Frame }[] = [
  { name: 'same_as_baseline', note: '기준 자세와 같다', p: BASELINE },
  { name: 'head_drop', note: '코가 0.06 내려감(고개 숙임). 머리 높이 변화가 허용 폭을 넘는다', p: pose({ nose: [0, 0.06] }) },
  { name: 'head_rise', note: '코가 0.06 올라감. 절댓값이라 숙임과 같은 크기', p: pose({ nose: [0, -0.06] }) },
  {
    name: 'lean_left_small',
    note: '코·귀가 사용자 왼쪽(화면 x 증가)으로 0.03. 좌우 치우침 0.15',
    p: pose({ nose: [0.03, 0], left_ear: [0.03, 0], right_ear: [0.03, 0] }),
  },
  {
    name: 'lean_left_large',
    note: '같은 방향 0.05. 좌우 치우침 0.25로 허용 폭 0.2를 넘는다',
    p: pose({ nose: [0.05, 0], left_ear: [0.05, 0], right_ear: [0.05, 0] }),
  },
  { name: 'left_shoulder_drop', note: '왼어깨 y +0.01. 어깨 기울기 허용 폭이 가장 좁다(0.03)', p: pose({ left_shoulder: [0, 0.01] }) },
  { name: 'slight_head_turn', note: '코만 x +0.02. 고개 돌림 0.1이라 판정한다', p: pose({ nose: [0.02, 0] }) },
  { name: 'head_turn', note: '코만 x +0.04. 고개 돌림 0.2 > 0.15라 판정하지 않는다', p: pose({ nose: [0.04, 0] }) },
  {
    name: 'head_turn_float_boundary',
    note: '코만 x +0.03. 수학적으로 0.15지만 부동소수점으로 0.15000000000000005가 되어 고개 돌림이다. 서버도 같은 연산 순서를 써야 한다',
    p: pose({ nose: [0.03, 0] }),
  },
  { name: 'nose_low_visibility', note: '코 visibility 0.6 < 0.65', p: pose({ nose: [0, 0, 0.6] }) },
  { name: 'visibility_at_boundary', note: '코 visibility 0.65는 판정 가능(이상)', p: pose({ nose: [0, 0, 0.65] }) },
  { name: 'shoulder_at_edge', note: '왼어깨 x 0.985 > 0.98(가장자리 2%)', p: pose({ left_shoulder: [0.385, 0] }) },
  {
    name: 'too_far',
    note: '어깨 폭이 화면 폭의 6% < 10%',
    p: pose({ left_shoulder: [-0.07, 0], right_shoulder: [0.07, 0] }),
  },
  {
    name: 'ears_low_visibility_still_used',
    note: '귀 visibility 0.1이어도 귀 좌표를 쓴다(visibility 검사 없음). 귀만 0.02 이동해 좌우 치우침 0.1, 고개 돌림 -0.1',
    p: pose({ left_ear: [0.02, 0, 0.1], right_ear: [0.02, 0, 0.1] }),
  },
  {
    name: 'one_ear_missing',
    note: '왼귀 좌표가 없음(null). 두 귀가 모두 있어야 판정한다(코로 대신하지 않음, BE 회신 S3)',
    p: pose({ left_ear: [NaN, NaN, 0] }),
  },
  { name: 'score_cap', note: '코 0.2 내려감. 점수는 1에서 멈춘다', p: pose({ nose: [0, 0.2] }) },
  { name: 'no_person', note: '사람이 안 잡힌 프레임(p: null)', p: null },
]

const baselineFeatures = features(landmarks(BASELINE), WIDTH, HEIGHT)!

function evaluate(frame: Frame) {
  const f = features(landmarks(frame), WIDTH, HEIGHT)
  const turned = headTurned(f, baselineFeatures)
  const deltas = turned ? null : featureDeltas(f, baselineFeatures)
  const observed: Observed = turned ? 'head_turn' : deltas ? 'measurable' : 'unmeasurable'
  return {
    features: named(f),
    observed,
    deltas: deltas && {
      head_gap: deltas.head_gap_delta,
      lateral_offset: deltas.lateral_offset_delta,
      shoulder_tilt: deltas.shoulder_tilt_delta,
      head_turn_offset: (f!.turn ?? 0) - (baselineFeatures.turn ?? 0),
    },
    score: deltas ? referenceScore(f!, baselineFeatures).score : null,
  }
}

const SEQUENCE_CASES: { name: string; note: string; frames: [number, string][] }[] = [
  {
    name: 'return_after_unmeasurable',
    note: '200ms에 판정 불가 1장. 3초(3200ms)까지 판정을 보류한다',
    frames: [
      [0, 'same_as_baseline'],
      [100, 'same_as_baseline'],
      [200, 'no_person'],
      [300, 'head_drop'],
      [1300, 'head_drop'],
      [2300, 'head_drop'],
      [3199, 'head_drop'],
      [3200, 'head_drop'],
      [3300, 'head_drop'],
    ],
  },
  {
    name: 'return_after_head_turn',
    note: '100ms에 고개 돌림. 1초(1100ms)까지 보류한다',
    frames: [
      [0, 'same_as_baseline'],
      [100, 'head_turn'],
      [600, 'same_as_baseline'],
      [1099, 'same_as_baseline'],
      [1100, 'same_as_baseline'],
      [1200, 'same_as_baseline'],
    ],
  },
  {
    name: 'turn_inside_unmeasurable_hold',
    note: '판정 불가(0ms) 보류 중 고개 돌림(500ms). 더 긴 쪽(3000ms)이 남는다',
    frames: [
      [0, 'no_person'],
      [500, 'head_turn'],
      [1400, 'same_as_baseline'],
      [2300, 'same_as_baseline'],
      [2999, 'same_as_baseline'],
      [3000, 'same_as_baseline'],
      [3100, 'same_as_baseline'],
    ],
  },
  {
    name: 'frame_gap_pauses',
    note: '프레임 사이가 1000ms를 넘으면 구간을 보내지 않고 측정을 멈춘다(사용자가 직접 재개)',
    frames: [
      [0, 'same_as_baseline'],
      [100, 'same_as_baseline'],
      [1101, 'same_as_baseline'],
    ],
  },
]

function runSequence(frames: [number, string][]) {
  const settle = new ReturnSettle()
  const judged: boolean[] = []
  const observed: Observed[] = []
  const intervals: { start_ms: number; end_ms: number; quality: 'good' | 'poor'; score: number | null }[] = []
  let pausedAtMs: number | null = null
  let previous: { t: number; judged: boolean } | null = null
  for (const [t, name] of frames) {
    const result = evaluate(FRAME_CASES.find((c) => c.name === name)!.p)
    const ok = settle.judge(t, result.observed)
    observed.push(result.observed)
    judged.push(ok)
    if (previous && t - previous.t > FRAME_EXPIRY_MS) {
      pausedAtMs = t
      break
    }
    // Same rule as ServerSessionController.ingest: both endpoints judged, current frame's deltas.
    if (previous) {
      const good = previous.judged && ok
      intervals.push({ start_ms: previous.t, end_ms: t, quality: good ? 'good' : 'poor', score: good ? result.score : null })
    }
    previous = { t, judged: ok }
  }
  return { observed, judged, intervals, paused_at_ms: pausedAtMs }
}

/** 16 frames over 3 s with small wobble, as during the 3 s baseline capture. */
const CALIBRATION_FRAMES: [number, Point[]][] = Array.from({ length: 16 }, (_, i) => {
  const wobble = [0, 0.004, -0.003, 0.006, -0.005, 0.002, -0.001, 0.005][i % 8]
  return [
    i * 200,
    pose({ nose: [wobble, wobble / 2], left_shoulder: [0, wobble], right_shoulder: [wobble, 0] }),
  ]
})

function calibration() {
  let draft = beginCalibration()
  let previous = 0
  let ready: Features | null = null
  for (const [t, p] of CALIBRATION_FRAMES) {
    const result = observeCalibration(draft, features(landmarks(p), WIDTH, HEIGHT), t, t - previous)
    draft = result.draft
    ready = result.ready ?? ready
    previous = t
  }
  const meanFrame: Point[] = JOINTS.map((_, j) => {
    const mean = (k: 0 | 1 | 2) => CALIBRATION_FRAMES.reduce((n, [, p]) => n + p[j][k], 0) / CALIBRATION_FRAMES.length
    return [mean(0), mean(1), mean(2)]
  })
  return {
    frames: CALIBRATION_FRAMES.map(([t, p]) => ({ t_ms: t, p })),
    app_baseline: named(ready),
    mean_landmarks: meanFrame.map(([x, y]) => [x, y]),
    features_of_mean_landmarks: named(features(landmarks(meanFrame), WIDTH, HEIGHT)),
  }
}

function build() {
  return {
    synthetic: true,
    description:
      '손으로 만든 합성 좌표다. 실제 영상·랜드마크·참여자 자료가 아니다. 기대값은 앱 코드(lee_app1)로 계산했다. 허용 폭과 경계값은 검증 전 실험값이다.',
    generated_by: 'frontend/src/features/session/server/referenceRuleCases.test.ts',
    rule_version: 'reference-rules-v0.2',
    spec: 'docs/design/fe-server-proposal.md',
    frame: { width: WIDTH, height: HEIGHT },
    joint_order: JOINT_NAMES,
    constants: {
      min_visibility: 0.65,
      edge_margin: 0.02,
      min_shoulder_span_ratio: 0.1,
      head_gap_scale: 0.22,
      lateral_offset_scale: 0.2,
      shoulder_tilt_scale: SHOULDER_TILT_SCALE,
      score_scale: 0.7,
      head_turn_limit: HEAD_TURN_LIMIT,
      return_settle_ms: RETURN_SETTLE_MS,
      turn_settle_ms: TURN_SETTLE_MS,
      frame_expiry_ms: FRAME_EXPIRY_MS,
      calibration_ms: CALIBRATION_MS,
      calibration_min_samples: CALIBRATION_MIN_SAMPLES,
    },
    baseline: { p: BASELINE, features: named(baselineFeatures) },
    frame_cases: FRAME_CASES.map(({ name, note, p }) => ({ name, note, p, expected: evaluate(p) })),
    sequence_cases: SEQUENCE_CASES.map(({ name, note, frames }) => ({
      name,
      note,
      frames: frames.map(([t_ms, frame]) => ({ t_ms, frame })),
      expected: runSequence(frames),
    })),
    calibration_case: {
      name: 'mean_of_features_vs_features_of_mean',
      note: '앱은 프레임마다 특징값을 계산해 평균한다. v4 계획처럼 좌표 평균 18개만 저장하면 서버는 평균 좌표로 특징값을 다시 계산하게 되어 값이 조금 다르다. 어느 쪽을 기준으로 할지 정해야 한다',
      ...calibration(),
    },
  }
}

const generated = build()
if (process.env.UPDATE_RULE_CASES) {
  mkdirSync(new URL('.', FILE), { recursive: true })
  writeFileSync(FILE, JSON.stringify(generated, null, 2) + '\n')
}

describe('reference rule cases for the server', () => {
  it('match the app rule code exactly', () => {
    expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(generated)))
  })

  // Hand-computed checks so the file is not only the code agreeing with itself.
  // Baseline: shoulder span 0.2 × 640 = 128 px, shoulder centre y 0.6, nose y 0.4.
  const frame = (name: string) => generated.frame_cases.find((c) => c.name === name)!.expected

  it('agrees with hand calculation', () => {
    expect(generated.baseline.features!.head_gap).toBeCloseTo((0.2 * 480) / 128, 12) // 0.75
    expect(generated.baseline.features!.lateral_offset).toBeCloseTo(0, 12)
    expect(frame('head_drop').deltas!.head_gap).toBeCloseTo((-0.06 * 480) / 128, 12) // -0.225
    expect(frame('head_drop').score).toBeCloseTo(0.7 * (0.225 / 0.22), 12)
    expect(frame('lean_left_small').deltas!.lateral_offset).toBeCloseTo((0.03 * 640) / 128, 12) // 0.15
    expect(frame('lean_left_small').score).toBeCloseTo(0.7 * 0.75, 12)
    expect(frame('lean_left_large').score).toBeCloseTo(0.7 * 1.25, 12)
    expect(frame('slight_head_turn').observed).toBe('measurable')
    expect(frame('head_turn').observed).toBe('head_turn')
    expect(frame('head_turn_float_boundary').observed).toBe('head_turn')
    expect(frame('visibility_at_boundary').observed).toBe('measurable')
    for (const name of ['nose_low_visibility', 'shoulder_at_edge', 'too_far', 'one_ear_missing', 'no_person'])
      expect(frame(name).observed).toBe('unmeasurable')
    expect(frame('ears_low_visibility_still_used').deltas!.lateral_offset).toBeCloseTo(0.1, 12)
    expect(frame('score_cap').score).toBe(1)
  })

  it('holds judgement for 3 s after unmeasurable and 1 s after a head turn', () => {
    const sequence = (name: string) => generated.sequence_cases.find((c) => c.name === name)!.expected
    expect(sequence('return_after_unmeasurable').judged).toEqual([true, true, false, false, false, false, false, true, true])
    expect(sequence('return_after_head_turn').judged).toEqual([true, false, false, false, true, true])
    expect(sequence('turn_inside_unmeasurable_hold').judged).toEqual([false, false, false, false, false, true, true])
    expect(sequence('frame_gap_pauses').paused_at_ms).toBe(1101)
  })
})
