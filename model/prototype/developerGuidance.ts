/** Experimental screen framing only: these settings do not define healthy posture. */
export const GUIDANCE_SETTINGS = {
  intro_step_ms: 1200, intro_steps: 3, stable_ms: 500, max_frame_gap_ms: 500,
  framing_grace_ms: 600, reference_grace_ms: 700, reference_max_frame_gap_ms: 1000,
  minimum_visibility: .5, minimum_shoulder_width: .25, maximum_shoulder_width: .72,
  center_x: .5, center_tolerance: .16, face_top: .12, face_bottom: .62,
  shoulder_top: .35, shoulder_bottom: .9, maximum_stable_group_shift: .1,
} as const

export interface GuidePoint { x: number; y: number; visibility: number }
export interface GuideFrame { points: GuidePoint[]; width: number; height: number; timeMs: number }
export type GuideCue = 'waiting' | 'missing' | 'center' | 'far' | 'close' | 'steady' | 'ready'
export interface GuideView {
  step: 'intro' | 'framing' | 'reference' | 'tracking'
  cue: GuideCue
  instruction: string
  detail: string
  ready: boolean
  holdProgress: number
  introStep: number
  live: GuideFrame | null
  reference: GuideFrame | null
  lateralPercent: number | null
  verticalPercent: number | null
  shoulderDegrees: number | null
}
const INTRO = [
  ['카메라를 정면에 놓아 주세요', '얼굴과 양쪽 어깨가 화면에 함께 보이면 됩니다.'],
  ['화면 가운데에 편안하게 앉아 주세요', '억지로 자세를 펴지 않아도 됩니다. 평소의 편안한 위치를 사용합니다.'],
  ['구도가 맞으면 자동으로 시작해요', '잠깐 구도를 확인한 뒤 8초 동안 편안한 자세를 기록합니다.'],
] as const
export const emptyGuidance = (): GuideView => ({ step: 'intro', cue: 'waiting',
  instruction: '시작하면 카메라 구도를 함께 확인해요', detail: '안내 · 구도 확인 · 8초 기준 등록 뒤 자동으로 측정합니다.',
  ready: false, holdProgress: 0, introStep: 0, live: null, reference: null,
  lateralPercent: null, verticalPercent: null, shoulderDegrees: null })

export function guideFrame(points: readonly { x: number; y: number; visibility?: number }[], width: number, height: number, timeMs: number): GuideFrame | null {
  if (points.length < 13 || ![width, height, timeMs].every(Number.isFinite) || width <= 0 || height <= 0 || timeMs < 0) return null
  const selected = points.slice(0, 13)
  if (selected.some(p => !p || ![p.x, p.y, p.visibility].every(Number.isFinite) ||
    (p.visibility ?? 0) < GUIDANCE_SETTINGS.minimum_visibility || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return null
  return { points: selected.map(p => ({ x: p.x, y: p.y, visibility: p.visibility! })), width, height, timeMs }
}

export function framingCue(frame: GuideFrame | null): GuideCue {
  if (!frame) return 'missing'
  const { points, width, height } = frame, left = points[11], right = points[12]
  const shoulderWidth = Math.hypot(left.x - right.x, (left.y - right.y) * height / width)
  if (shoulderWidth < GUIDANCE_SETTINGS.minimum_shoulder_width) return 'far'
  if (shoulderWidth > GUIDANCE_SETTINGS.maximum_shoulder_width) return 'close'
  const centerX = (left.x + right.x) / 2, shoulderY = (left.y + right.y) / 2
  const faceX = points.slice(0, 11).reduce((sum, point) => sum + point.x, 0) / 11
  const faceY = points.slice(0, 11).reduce((sum, point) => sum + point.y, 0) / 11
  if (Math.abs(centerX - GUIDANCE_SETTINGS.center_x) > GUIDANCE_SETTINGS.center_tolerance ||
    Math.abs(faceX - GUIDANCE_SETTINGS.center_x) > GUIDANCE_SETTINGS.center_tolerance ||
    faceY < GUIDANCE_SETTINGS.face_top || faceY > GUIDANCE_SETTINGS.face_bottom ||
    shoulderY < GUIDANCE_SETTINGS.shoulder_top || shoulderY > GUIDANCE_SETTINGS.shoulder_bottom) return 'center'
  return 'ready'
}
const CUES: Record<GuideCue, [string, string]> = {
  waiting: ['카메라 관측을 기다리고 있어요', '얼굴과 양쪽 어깨를 함께 보여 주세요.'],
  missing: ['얼굴과 양쪽 어깨를 보여 주세요', '가려진 부분이 없는지, 화면 밖으로 벗어나지 않았는지 확인해 주세요.'],
  center: ['얼굴과 어깨를 화면 가운데로 맞춰 주세요', '카메라 높이와 방향을 조절해 얼굴은 위쪽, 어깨는 아래쪽에 담아 주세요.'],
  far: ['카메라에 조금 가까이 와 주세요', '얼굴과 양쪽 어깨가 충분히 크게 보이도록 거리를 조절해 주세요.'],
  close: ['카메라에서 조금 멀어져 주세요', '양쪽 어깨가 화면 안에 여유 있게 들어오도록 해 주세요.'],
  steady: ['좋아요, 편안하게 앉아 계세요', '얼굴과 어깨가 보이면 곧 기준 등록을 시작합니다. 작은 움직임은 괜찮아요.'],
  ready: ['구도가 준비됐어요', '편안한 위치를 유지하면 개인 기준을 기록합니다.'],
}
const shoulderAngle = (frame: GuideFrame) => {
  const left = frame.points[11], right = frame.points[12]
  let angle = Math.atan2((right.y - left.y) * frame.height, (right.x - left.x) * frame.width) * 180 / Math.PI
  if (angle > 90) angle -= 180
  if (angle < -90) angle += 180
  return angle
}
export function geometryDelta(live: GuideFrame | null, reference: GuideFrame | null) {
  if (!live || !reference) return { lateralPercent: null, verticalPercent: null, shoulderDegrees: null }
  let degrees = shoulderAngle(live) - shoulderAngle(reference)
  if (degrees > 90) degrees -= 180
  if (degrees < -90) degrees += 180
  return { lateralPercent: (live.points[0].x - reference.points[0].x) * 100,
    verticalPercent: (live.points[0].y - reference.points[0].y) * 100, shoulderDegrees: degrees }
}

// Framing needs a usable face/shoulder composition, not thirteen motionless points.
// Group means absorb individual landmark jitter while the fixed anchor still
// rejects sustained whole-body drift, camera movement and substantial scale changes.
const framingGeometry = (frame: GuideFrame) => {
  const face = frame.points.slice(0, 11)
  const left = frame.points[11], right = frame.points[12]
  const aspect = frame.height / frame.width
  return {
    faceX: face.reduce((sum, p) => sum + p.x, 0) / face.length,
    faceY: face.reduce((sum, p) => sum + p.y, 0) / face.length * aspect,
    shoulderX: (left.x + right.x) / 2,
    shoulderY: (left.y + right.y) / 2 * aspect,
    shoulderWidth: Math.hypot(left.x - right.x, (left.y - right.y) * aspect),
  }
}
const compositionChanged = (anchor: GuideFrame, live: GuideFrame) => {
  if (anchor.width !== live.width || anchor.height !== live.height) return true
  const a = framingGeometry(anchor), b = framingGeometry(live)
  return Math.max(Math.hypot(a.faceX - b.faceX, a.faceY - b.faceY),
    Math.hypot(a.shoulderX - b.shoulderX, a.shoulderY - b.shoulderY),
    Math.abs(a.shoulderWidth - b.shoulderWidth)) > GUIDANCE_SETTINGS.maximum_stable_group_shift
}

/** Keeps only transient display geometry and a running reference mean. */
export class DeveloperGuide {
  private view = emptyGuidance()
  private holdMs = 0
  private interruptedAt: number | null = null
  private lastStable = false
  private anchor: GuideFrame | null = null
  private lastAt: number | null = null
  private sum: { x: number; y: number; visibility: number }[] | null = null
  private referenceSamples = 0
  constructor(private readonly startedAt: number) {}
  get current() { return this.view }
  private resetHold() {
    this.holdMs = 0; this.interruptedAt = null; this.lastStable = false; this.anchor = null
  }
  observe(timeMs: number, live: GuideFrame | null): GuideView {
    const gap = this.lastAt === null ? 0 : timeMs - this.lastAt
    const dimensionsChanged = !!(live && this.anchor && (live.width !== this.anchor.width || live.height !== this.anchor.height))
    if (gap < 0 || (this.lastAt !== null && gap === 0) || gap > GUIDANCE_SETTINGS.max_frame_gap_ms || dimensionsChanged) this.resetHold()
    this.lastAt = timeMs
    if (this.view.step === 'intro') {
      const step = Math.floor(Math.max(0, timeMs - this.startedAt) / GUIDANCE_SETTINGS.intro_step_ms)
      if (step < GUIDANCE_SETTINGS.intro_steps) {
        this.view = { ...this.view, introStep: step, live, instruction: INTRO[step][0], detail: INTRO[step][1] }
        return this.view
      }
      this.view = { ...this.view, step: 'framing', introStep: GUIDANCE_SETTINGS.intro_steps - 1 }
    }
    if (this.view.step === 'tracking') {
      this.view = { ...this.view, live, ready: !!live, cue: live ? 'ready' : 'missing', holdProgress: 0,
        instruction: live ? '기준과 현재 움직임을 비교하고 있어요' : CUES.missing[0],
        detail: live ? '편안하게 움직여 보세요. 선과 수치는 화면에서 관찰한 변화입니다.' : CUES.missing[1],
        ...geometryDelta(live, this.view.reference) }
      return this.view
    }
    const reference = this.view.step === 'reference'
    // Registration collects valid observations of a comfortable pose; it does
    // not ask the person to stay at the exact pixels used to enter the guide.
    // A short loss contributes no reference sample and cannot complete it.
    if (reference) {
      if (dimensionsChanged || gap > GUIDANCE_SETTINGS.reference_max_frame_gap_ms) return this.realign()
      if (!live) {
        this.interruptedAt ??= timeMs
        if (timeMs - this.interruptedAt >= GUIDANCE_SETTINGS.reference_grace_ms) return this.realign()
      } else this.interruptedAt = null
    }
    const cue = framingCue(live)
    if (!reference && this.interruptedAt !== null && timeMs - this.interruptedAt >= GUIDANCE_SETTINGS.framing_grace_ms) this.resetHold()
    const stable = reference ? !!live : !dimensionsChanged && cue === 'ready' && !!live && (!this.anchor || !compositionChanged(this.anchor, live))
    if (!reference) {
      if (stable && live) {
        if (this.anchor && this.lastStable && this.interruptedAt === null) this.holdMs += Math.max(0, gap)
        this.anchor ??= live
        this.interruptedAt = null
      } else {
        this.interruptedAt ??= timeMs
        if (timeMs - this.interruptedAt >= GUIDANCE_SETTINGS.framing_grace_ms) {
          this.resetHold()
          if (cue === 'ready' && live) this.anchor = live
        }
      }
      this.lastStable = stable
    }
    const progress = reference ? (stable ? 1 : 0) : Math.min(1, this.holdMs / GUIDANCE_SETTINGS.stable_ms)
    const ready = stable && (reference || progress >= 1)
    const displayCue = cue === 'ready' && !ready ? 'steady' : cue
    this.view = { ...this.view, live, cue: displayCue, ready, holdProgress: progress,
      instruction: reference && ready ? '편안한 자세를 8초 동안 기록하고 있어요' : CUES[displayCue][0],
      detail: reference && ready ? '작은 움직임은 괜찮아요. 얼굴과 양쪽 어깨가 보이면 자동으로 측정합니다.' : CUES[displayCue][1],
      lateralPercent: null, verticalPercent: null, shoulderDegrees: null }
    return this.view
  }
  startReference() {
    this.sum = null; this.referenceSamples = 0
    this.interruptedAt = null
    this.view = { ...this.view, step: 'reference', ready: true, holdProgress: 1, reference: null,
      instruction: '편안한 자세를 8초 동안 기록하고 있어요', detail: '작은 움직임은 괜찮아요. 얼굴과 양쪽 어깨가 보이면 자동으로 측정합니다.' }
    return this.view
  }
  captureReference(frame: GuideFrame) {
    this.sum ??= frame.points.map(() => ({ x: 0, y: 0, visibility: 0 }))
    frame.points.forEach((point, i) => { this.sum![i].x += point.x; this.sum![i].y += point.y; this.sum![i].visibility += point.visibility })
    this.referenceSamples++
  }
  completeReference() {
    if (this.sum && this.referenceSamples && this.view.live) {
      const reference = { ...this.view.live, points: this.sum.map(point => ({
        x: point.x / this.referenceSamples, y: point.y / this.referenceSamples, visibility: point.visibility / this.referenceSamples,
      })) }
      this.view = { ...this.view, step: 'tracking', reference, ...geometryDelta(this.view.live, reference) }
    }
    this.sum = null; this.referenceSamples = 0
    return this.view
  }
  realign() {
    this.resetHold(); this.sum = null; this.referenceSamples = 0
    this.view = { ...this.view, step: 'framing', ready: false, holdProgress: 0, live: null, reference: null,
      lateralPercent: null, verticalPercent: null, shoulderDegrees: null }
    return this.view
  }
}

/** Explicit synthetic screen geometry for the opt-in demonstration. */
export function syntheticGuideFrame(timeMs: number): GuideFrame | null {
  if (timeMs >= 34_000 && timeMs < 37_000) return null
  const moved = (timeMs >= 13_000 && timeMs < 14_200) || (timeMs >= 19_000 && timeMs < 27_000)
  const locations = [[.5,.33],[.46,.3],[.45,.3],[.44,.3],[.54,.3],[.55,.3],[.56,.3],
    [.41,.33],[.59,.33],[.47,.38],[.53,.38],[.3,.68],[.7,.68]]
  return { width: 1280, height: 720, timeMs, points: locations.map(([x, y], i) => ({
    x: x + (i < 11 && moved ? .1 : 0), y: y + (i < 11 ? .0008 * Math.sin(timeMs / 900 + i) : 0), visibility: .99,
  })) }
}
