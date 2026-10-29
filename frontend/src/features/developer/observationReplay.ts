import { liveForecastPoints, LIVE_FORECAST_ORDER } from '../../../../model/prototype/forecast'
import type { Landmark } from '../../../../model/prototype/pose'
import { comparisonGeometry, type ComparisonFrame } from '../../../../model/prototype/observationComparison'
import { REPLAY_TASKS, type ComparisonAction, type ReplayTask } from './comparisonDemo'
import { DEFAULT_GUIDE_PLAN, OBSERVATION_PROTOCOL, type GuidePlan } from './observationProtocol'

export const REPLAY_LIMIT = 6000
export const REPLAY_FILE_LIMIT = 32 * 1024 * 1024
/** v2 keeps the original indices 0..22: face/shoulders 0..12 plus elbows, wrists and hands 13..22. */
const POINT_COUNT = 23
const LEGACY_POINT_COUNT = 13
const SCHEMA = 'observation-keypoint-replay-v2'
const LEGACY_SCHEMA = 'observation-keypoint-replay-v1'
export const REPLAY_PHASES = ['connecting', 'preparing', 'registering', 'interrupted', 'idle', 'move', 'hold', 'return', 'waiting', 'paused', 'completed', 'cancelled'] as const
export type ReplayPhase = typeof REPLAY_PHASES[number]
const LEGACY_PROTOCOL_IDS = ['front-observation-2-5-5x3-v2', 'front-observation-manual-ready-5-5x3-v3'] as const
export type ReplayPoint = { x: number; y: number; z: number; visibility: number | null }
export type ReplayContext = { phase: ReplayPhase; task: ComparisonAction; round: number | null; trial: number | null; attempt: number; segment: number; measurement: boolean }
export type ReplayArmFrame = { armLandmarks?: Landmark[]; armWorldLandmarks?: Landmark[] }
export type ReplayFrame = Omit<ReplayContext, 'task'> & {
  task: ReplayTask
  elapsedMs: number; observationTimeMs: number | null; videoTimeMs: number | null
  width: number; height: number; poseModelId: string | null
  image: (ReplayPoint | null)[]; world: (ReplayPoint | null)[]
}
export type ReplayMarker = { elapsedMs: number; afterFrame: number; reason: 'hidden' | 'interrupted' | 'stopped' }
export type ObservationReplayData = {
  schema_version: typeof SCHEMA | typeof LEGACY_SCHEMA; source: 'camera' | 'synthetic'
  runId: string; startedAt: string; protocolId: typeof OBSERVATION_PROTOCOL.id | typeof LEGACY_PROTOCOL_IDS[number]
  /** v2 only: the run's round count and whether the in-round order was shuffled. */
  plan: GuidePlan | null
  pointIndices: number[]; forecastOrder: number[]; mirrored: false
  labelKind: 'guided_task_not_ground_truth'; scope: 'all_phases_replay_only'
  frames: ReplayFrame[]; markers: ReplayMarker[]; droppedFrames: number
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const nonnegative = (v: unknown): v is number => finite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER
const integer = (v: unknown): v is number => nonnegative(v) && Number.isInteger(v)
const point = (p: Landmark | undefined): ReplayPoint | null => p && [p.x,p.y,p.z].every(v => finite(v) && Math.abs(v) <= 10000)
  ? { x: p.x, y: p.y, z: p.z, visibility: finite(p.visibility) && p.visibility >= 0 && p.visibility <= 1 ? p.visibility : null } : null
// Missing arm output stays null; it is never padded with zeros or copied from another frame.
const copyPoints = (points: Landmark[], arms: Landmark[] = []) => Array.from({ length: POINT_COUNT }, (_, i) => point(i < LEGACY_POINT_COUNT ? points[i] : arms[i - LEGACY_POINT_COUNT]))
const landmarks = (points: (ReplayPoint | null)[]): Landmark[] => points.map(p => p ? { ...p, visibility: p.visibility ?? undefined } : { x: NaN, y: NaN, z: NaN, visibility: 0 })
export function replayFeatures(frame: ReplayFrame) { return liveForecastPoints(landmarks(frame.image), landmarks(frame.world)) }
export function replayImageValid(frame: ReplayFrame) {
  return !!comparisonGeometry({ timeMs: frame.observationTimeMs ?? 0, width: frame.width, height: frame.height, landmarks: landmarks(frame.image), worldLandmarks: [] }).image
}

/** Bounded, unsmoothed local replay archive. No persistence or service/model side effects. */
export class ObservationReplayArchive {
  private frames: ReplayFrame[] = []
  private markers: ReplayMarker[] = []
  private dropped = 0
  private lastObservation: number | null = null
  private plan: GuidePlan = DEFAULT_GUIDE_PLAN
  constructor(private runId: string, private startedAt: string) {}
  get count() { return this.frames.length }
  get droppedFrames() { return this.dropped }
  setPlan(plan: GuidePlan) { this.plan = { ...plan } }
  append(frame: ComparisonFrame & ReplayArmFrame & { videoTimeMs?: number }, elapsedMs: number, context: ReplayContext) {
    if (!nonnegative(elapsedMs) || this.frames.length && elapsedMs <= this.frames.at(-1)!.elapsedMs) return
    if (!finite(frame.width) || !finite(frame.height) || frame.width <= 0 || frame.height <= 0 || frame.width > 8192 || frame.height > 8192) return
    if (this.frames.length >= REPLAY_LIMIT) { this.dropped++; return }
    const validTime = nonnegative(frame.timeMs) && (this.lastObservation === null || frame.timeMs > this.lastObservation)
    if (validTime) this.lastObservation = frame.timeMs
    this.frames.push({ ...context, elapsedMs, observationTimeMs: validTime ? frame.timeMs : null,
      videoTimeMs: nonnegative(frame.videoTimeMs) ? frame.videoTimeMs : null,
      width: frame.width, height: frame.height, poseModelId: frame.poseModelId?.slice(0, 160) || null,
      image: validTime ? copyPoints(frame.landmarks, frame.armLandmarks) : Array(POINT_COUNT).fill(null),
      world: validTime ? copyPoints(frame.worldLandmarks, frame.armWorldLandmarks) : Array(POINT_COUNT).fill(null) })
  }
  mark(elapsedMs: number, reason: ReplayMarker['reason']) {
    if (!this.frames.length || !nonnegative(elapsedMs) || elapsedMs < this.frames.at(-1)!.elapsedMs || this.markers.length >= REPLAY_LIMIT * 2) return
    const afterFrame = this.frames.length - 1, previous = this.markers.at(-1)
    if (previous?.afterFrame === afterFrame && previous.reason === reason) return
    if (previous && elapsedMs < previous.elapsedMs) return
    this.markers.push({ elapsedMs, afterFrame, reason })
  }
  snapshot(): ObservationReplayData {
    return { schema_version: SCHEMA, source: 'camera', runId: this.runId, startedAt: this.startedAt,
      protocolId: OBSERVATION_PROTOCOL.id, plan: { ...this.plan }, pointIndices: Array.from({ length: POINT_COUNT }, (_, i) => i), forecastOrder: [...LIVE_FORECAST_ORDER],
      mirrored: false, labelKind: 'guided_task_not_ground_truth', scope: 'all_phases_replay_only',
      frames: this.frames.map(f => ({ ...f, image: f.image.map(p => p && { ...p }), world: f.world.map(p => p && { ...p }) })),
      markers: this.markers.map(m => ({ ...m })), droppedFrames: this.dropped }
  }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const fail = (): never => { throw new Error('지원하는 키포인트 리플레이 JSON이 아닙니다. 원래 파일을 확인해 주세요.') }
const text = (v: unknown, max = 160): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const sequence = (v: unknown, expected: number[]) => Array.isArray(v) && v.length === expected.length && v.every((x, i) => x === expected[i])
function readPoints(value: unknown, count: number): (ReplayPoint | null)[] {
  if (!Array.isArray(value) || value.length !== count) return fail()
  return value.map(p => {
    if (p === null) return null
    if (!object(p) || ![p.x,p.y,p.z].every(v => finite(v) && Math.abs(v) <= 10000) || !(p.visibility === null || finite(p.visibility) && p.visibility >= 0 && p.visibility <= 1)) return fail()
    return { x: p.x as number, y: p.y as number, z: p.z as number, visibility: p.visibility as number | null }
  })
}
function readPlan(value: unknown): GuidePlan {
  if (!object(value) || !(OBSERVATION_PROTOCOL.roundOptions as readonly unknown[]).includes(value.rounds) || typeof value.shuffle !== 'boolean') return fail()
  return { rounds: value.rounds as GuidePlan['rounds'], shuffle: value.shuffle }
}
export function parseObservationReplay(content: string): ObservationReplayData {
  if (new Blob([content]).size > REPLAY_FILE_LIMIT) throw new Error('리플레이 파일은 32MB 이하만 불러올 수 있어요.')
  let data: unknown
  try { data = JSON.parse(content) } catch { return fail() }
  if (!object(data) || (data.schema_version !== SCHEMA && data.schema_version !== LEGACY_SCHEMA)) return fail()
  const legacy = data.schema_version === LEGACY_SCHEMA, count = legacy ? LEGACY_POINT_COUNT : POINT_COUNT
  const plan = legacy ? null : readPlan(data.plan)
  // A v1 file can only carry v1/v2 protocols and the old four actions; v2 only the current protocol.
  const tasks: readonly string[] = legacy ? REPLAY_TASKS.map(task => task.id) : ['neutral', ...OBSERVATION_PROTOCOL.actions]
  const rounds = plan?.rounds ?? 3, trials = plan ? plan.rounds * OBSERVATION_PROTOCOL.actions.length : 12
  if (!['camera','synthetic'].includes(String(data.source)) ||
    !text(data.runId) || !text(data.startedAt, 40) || !Number.isFinite(Date.parse(data.startedAt)) ||
    !(legacy ? (LEGACY_PROTOCOL_IDS as readonly unknown[]).includes(data.protocolId) : data.protocolId === OBSERVATION_PROTOCOL.id) ||
    !sequence(data.pointIndices, Array.from({length: count}, (_, i) => i)) || !sequence(data.forecastOrder, LIVE_FORECAST_ORDER) ||
    data.mirrored !== false || data.labelKind !== 'guided_task_not_ground_truth' || data.scope !== 'all_phases_replay_only' ||
    !integer(data.droppedFrames) || !Array.isArray(data.frames) || !data.frames.length || data.frames.length > REPLAY_LIMIT ||
    !Array.isArray(data.markers) || data.markers.length > REPLAY_LIMIT * 2) return fail()
  let previous = -1, lastObservation = -1
  const frames: ReplayFrame[] = data.frames.map(f => {
    if (!object(f) || !nonnegative(f.elapsedMs) || f.elapsedMs <= previous || !(f.observationTimeMs === null || nonnegative(f.observationTimeMs) && f.observationTimeMs > lastObservation) ||
      !(f.videoTimeMs === null || nonnegative(f.videoTimeMs)) || !finite(f.width) || !finite(f.height) || f.width <= 0 || f.height <= 0 || f.width > 8192 || f.height > 8192 ||
      !(f.poseModelId === null || text(f.poseModelId)) || !REPLAY_PHASES.includes(f.phase as ReplayPhase) || !tasks.includes(String(f.task)) ||
      !(f.round === null || integer(f.round) && f.round >= 1 && f.round <= rounds) || !(f.trial === null || integer(f.trial) && f.trial >= 1 && f.trial <= trials) ||
      !integer(f.attempt) || !integer(f.segment) || typeof f.measurement !== 'boolean' || f.measurement && f.phase !== 'hold') return fail()
    previous = f.elapsedMs
    if (f.observationTimeMs !== null) lastObservation = f.observationTimeMs as number
    const image = readPoints(f.image, count), world = readPoints(f.world, count)
    if (f.observationTimeMs === null && [...image,...world].some(p => p !== null)) return fail()
    return { elapsedMs: f.elapsedMs, observationTimeMs: f.observationTimeMs, videoTimeMs: f.videoTimeMs, width: f.width, height: f.height,
      poseModelId: f.poseModelId, phase: f.phase, task: f.task, round: f.round, trial: f.trial, attempt: f.attempt, segment: f.segment,
      measurement: f.measurement, image, world } as ReplayFrame
  })
  let markerTime = -1, markerFrame = -1
  const markers: ReplayMarker[] = data.markers.map(m => {
    if (!object(m) || !nonnegative(m.elapsedMs) || m.elapsedMs < markerTime || !integer(m.afterFrame) || m.afterFrame < markerFrame || m.afterFrame >= frames.length ||
      m.elapsedMs < frames[m.afterFrame].elapsedMs || !['hidden','interrupted','stopped'].includes(String(m.reason))) return fail()
    markerTime = m.elapsedMs; markerFrame = m.afterFrame
    return { elapsedMs: m.elapsedMs, afterFrame: m.afterFrame, reason: m.reason as ReplayMarker['reason'] }
  })
  return { schema_version: legacy ? LEGACY_SCHEMA : SCHEMA, source: data.source as 'camera' | 'synthetic', runId: data.runId, startedAt: data.startedAt,
    protocolId: data.protocolId as ObservationReplayData['protocolId'], plan, pointIndices: Array.from({length: count}, (_, i) => i), forecastOrder: [...LIVE_FORECAST_ORDER], mirrored: false,
    labelKind: 'guided_task_not_ground_truth', scope: 'all_phases_replay_only', frames, markers, droppedFrames: data.droppedFrames }
}
export function replayIndexAt(frames: ReplayFrame[], timeMs: number) {
  let low = 0, high = frames.length
  while (low < high) { const mid = (low + high) >>> 1; if (frames[mid].elapsedMs <= timeMs) low = mid + 1; else high = mid }
  return low - 1
}
export function replayFrameAt(data: ObservationReplayData, timeMs: number): ReplayFrame | null {
  const index = replayIndexAt(data.frames, timeMs), frame = data.frames[index]
  if (!frame || timeMs - frame.elapsedMs > 500 || data.markers.some(m => m.elapsedMs <= timeMs && m.afterFrame >= index)) return null
  return frame
}
export function downloadObservationReplay(data: ObservationReplayData) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = `posture-keypoint-replay-${data.source}-${Date.now()}.json`
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
