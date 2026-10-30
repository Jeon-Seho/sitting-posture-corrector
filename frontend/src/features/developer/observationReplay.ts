import { liveForecastPoints, LIVE_FORECAST_ORDER } from '../../../../model/prototype/forecast'
import type { Landmark } from '../../../../model/prototype/pose'
import { comparisonGeometry, type ComparisonFrame } from '../../../../model/prototype/observationComparison'
import { REPLAY_TASKS, type ComparisonAction, type ReplayTask } from './comparisonDemo'
import { DEFAULT_GUIDE_PLAN, OBSERVATION_PROTOCOL, type GuidePlan } from './observationProtocol'

export const REPLAY_LIMIT = 6000
export const REPLAY_FILE_LIMIT = 64 * 1024 * 1024
/** v2 keeps the original indices 0..22: face/shoulders 0..12 plus elbows, wrists and hands 13..22. */
const POINT_COUNT = 33
const V4_POINT_COUNT = 23
const LEGACY_POINT_COUNT = 13
const SCHEMA = 'observation-keypoint-replay-v5'
const V4_SCHEMA = 'observation-keypoint-replay-v4'
const V3_SCHEMA = 'observation-keypoint-replay-v3'
const V3_PROTOCOL = 'front-observation-optional-stretch-v5'
const V2_SCHEMA = 'observation-keypoint-replay-v2'
const V2_PROTOCOL = 'front-observation-deviation-stretch-v4'
const LEGACY_SCHEMA = 'observation-keypoint-replay-v1'
export const REPLAY_PHASES = ['connecting', 'preparing', 'registering', 'interrupted', 'idle', 'move', 'hold', 'return', 'waiting', 'paused', 'completed', 'cancelled'] as const
export type ReplayPhase = typeof REPLAY_PHASES[number]
const LEGACY_PROTOCOL_IDS = ['front-observation-2-5-5x3-v2', 'front-observation-manual-ready-5-5x3-v3'] as const
export type ReplayPoint = { x: number; y: number; z: number; visibility: number | null }
export type ReplayContext = { phase: ReplayPhase; task: ComparisonAction; round: number | null; trial: number | null; attempt: number; segment: number; measurement: boolean }
export type ReplayArmFrame = { armLandmarks?: Landmark[]; armWorldLandmarks?: Landmark[]; extraLandmarks?: Landmark[]; extraWorldLandmarks?: Landmark[]; inferenceMs?: number; delegate?: 'CPU' | 'GPU'; shoulders?: 'seen' | 'grace' | 'missing'; features?: { headGap: number; offset: number; tilt: number; quality: number; turn?: number } | null }
export type ReplayFrame = Omit<ReplayContext, 'task'> & {
  task: ReplayTask
  elapsedMs: number; observationTimeMs: number | null; videoTimeMs: number | null
  width: number; height: number; poseModelId: string | null
  rawObservationTimeMs?: number | null; inferenceMs?: number | null; delegate?: 'CPU' | 'GPU' | null; shoulders?: 'seen' | 'grace' | 'missing' | null
  rawFeatures?: { headGap: number; offset: number; tilt: number; quality: number; turn: number | null } | null
  image: (ReplayPoint | null)[]; world: (ReplayPoint | null)[]
}
export type ReplayMarker = { elapsedMs: number; afterFrame: number; reason: 'hidden' | 'interrupted' | 'stopped' }
export type ObservationReplayData = {
  schema_version: typeof SCHEMA | typeof V4_SCHEMA | typeof V3_SCHEMA | typeof V2_SCHEMA | typeof LEGACY_SCHEMA; source: 'camera' | 'synthetic'
  runId: string; startedAt: string; protocolId: typeof OBSERVATION_PROTOCOL.id | typeof V3_PROTOCOL | typeof V2_PROTOCOL | typeof LEGACY_PROTOCOL_IDS[number]
  /** v2 only: the run's round count and whether the in-round order was shuffled. */
  plan: GuidePlan | null
  guideMode?: 'auto' | 'manual'
  stretchNotes?: { round: number; trial: number; note: string }[]
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
const copyPoints = (points: Landmark[], arms: Landmark[] = [], extra: Landmark[] = []) => Array.from({ length: POINT_COUNT }, (_, i) => point(i < LEGACY_POINT_COUNT ? points[i] : i < V4_POINT_COUNT ? arms[i - LEGACY_POINT_COUNT] : extra[i - V4_POINT_COUNT]))
const landmarks = (points: (ReplayPoint | null)[]): Landmark[] => points.map(p => p ? { ...p, visibility: p.visibility ?? undefined } : { x: NaN, y: NaN, z: NaN, visibility: 0 })
export function replayFeatures(frame: ReplayFrame) { return frame.observationTimeMs === null ? null : liveForecastPoints(landmarks(frame.image), landmarks(frame.world)) }
export function replayImageValid(frame: ReplayFrame) {
  return frame.observationTimeMs !== null && !!comparisonGeometry({ timeMs: frame.observationTimeMs ?? 0, width: frame.width, height: frame.height, landmarks: landmarks(frame.image), worldLandmarks: [] }).image
}

/** Bounded, unsmoothed local replay archive. No persistence or service/model side effects. */
export class ObservationReplayArchive {
  private frames: ReplayFrame[] = []
  private markers: ReplayMarker[] = []
  private dropped = 0
  private lastObservation: number | null = null
  private plan: GuidePlan = DEFAULT_GUIDE_PLAN
  private guideMode: 'auto' | 'manual' = 'auto'
  private notes: { round: number; trial: number; note: string }[] = []
  constructor(private runId: string, private startedAt: string) {}
  get count() { return this.frames.length }
  get droppedFrames() { return this.dropped }
  stretchNoteForRound(round: number | undefined) { return this.notes.find(item => item.round === round)?.note ?? '' }
  setGuideMode(mode: 'auto' | 'manual') { this.guideMode = mode }
  addStretchNote(round: number, trial: number, note: string) { this.notes.push({ round, trial, note: note.slice(0, 120) }) }
  setPlan(plan: GuidePlan) { this.plan = { ...plan, cycle: plan.cycle ?? 'repeat', stretchNote: plan.cycle === 'stretch' ? (plan.stretchNote ?? '').slice(0, 120) : '' } }
  append(frame: ComparisonFrame & ReplayArmFrame & { videoTimeMs?: number }, elapsedMs: number, context: ReplayContext) {
    if (!nonnegative(elapsedMs) || this.frames.length && elapsedMs <= this.frames.at(-1)!.elapsedMs) return
    if (!finite(frame.width) || !finite(frame.height) || frame.width <= 0 || frame.height <= 0 || frame.width > 8192 || frame.height > 8192) return
    if (this.frames.length >= REPLAY_LIMIT) { this.dropped++; return }
    const validTime = nonnegative(frame.timeMs) && (this.lastObservation === null || frame.timeMs > this.lastObservation)
    if (validTime) this.lastObservation = frame.timeMs
    this.frames.push({ ...context, elapsedMs, observationTimeMs: validTime ? frame.timeMs : null,
      videoTimeMs: nonnegative(frame.videoTimeMs) ? frame.videoTimeMs : null,
      width: frame.width, height: frame.height, poseModelId: frame.poseModelId?.slice(0, 160) || null,
      rawObservationTimeMs: finite(frame.timeMs) ? frame.timeMs : null,
      rawFeatures: frame.features && [frame.features.headGap, frame.features.offset, frame.features.tilt, frame.features.quality].every(finite) ? { headGap: frame.features.headGap, offset: frame.features.offset, tilt: frame.features.tilt, quality: frame.features.quality, turn: finite(frame.features.turn) ? frame.features.turn : null } : null,
      inferenceMs: nonnegative(frame.inferenceMs) ? frame.inferenceMs : null, delegate: frame.delegate === 'CPU' || frame.delegate === 'GPU' ? frame.delegate : null, shoulders: frame.shoulders === 'seen' || frame.shoulders === 'grace' || frame.shoulders === 'missing' ? frame.shoulders : null,
      image: copyPoints(frame.landmarks, frame.armLandmarks, frame.extraLandmarks),
      world: copyPoints(frame.worldLandmarks, frame.armWorldLandmarks, frame.extraWorldLandmarks) })
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
      protocolId: OBSERVATION_PROTOCOL.id, plan: { ...this.plan }, guideMode: this.guideMode, stretchNotes: this.notes.map(note => ({ ...note })), pointIndices: Array.from({ length: POINT_COUNT }, (_, i) => i), forecastOrder: [...LIVE_FORECAST_ORDER],
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
function readPlan(value: unknown, modern: boolean, current: boolean): GuidePlan {
  if (!object(value) || !(current ? OBSERVATION_PROTOCOL.roundOptions as readonly unknown[] : [1, 3]).includes(value.rounds) || typeof value.shuffle !== 'boolean') return fail()
  if (modern && (value.shuffle !== false || !['repeat', 'stretch'].includes(String(value.cycle)) || typeof value.stretchNote !== 'string' || value.stretchNote.length > 120 || (value.cycle === 'repeat' && value.stretchNote !== ''))) return fail()
  return modern ? { rounds: value.rounds as GuidePlan['rounds'], shuffle: value.shuffle, cycle: value.cycle as GuidePlan['cycle'], stretchNote: value.stretchNote as string } : { rounds: value.rounds as GuidePlan['rounds'], shuffle: value.shuffle }
}
export function parseObservationReplay(content: string): ObservationReplayData {
  if (new Blob([content]).size > REPLAY_FILE_LIMIT) throw new Error('리플레이 파일은 64MB 이하만 불러올 수 있어요.')
  let data: unknown
  try { data = JSON.parse(content) } catch { return fail() }
  if (!object(data) || (data.schema_version !== SCHEMA && data.schema_version !== V4_SCHEMA && data.schema_version !== V3_SCHEMA && data.schema_version !== V2_SCHEMA && data.schema_version !== LEGACY_SCHEMA)) return fail()
  const legacy = data.schema_version === LEGACY_SCHEMA, count = legacy ? LEGACY_POINT_COUNT : data.schema_version === SCHEMA ? POINT_COUNT : V4_POINT_COUNT
  const current = data.schema_version === SCHEMA || data.schema_version === V4_SCHEMA, v3 = data.schema_version === V3_SCHEMA
  const plan = legacy ? null : readPlan(data.plan, current || v3, current)
  // A v1 file can only carry v1/v2 protocols and the old four actions; v2 only the current protocol.
  const tasks: readonly string[] = legacy ? REPLAY_TASKS.map(task => task.id) : ['neutral', ...OBSERVATION_PROTOCOL.actions]
  const rounds = plan?.rounds ?? 3, trials = plan ? plan.rounds * OBSERVATION_PROTOCOL.actions.length : 12
  if (!['camera','synthetic'].includes(String(data.source)) ||
    !text(data.runId) || !text(data.startedAt, 40) || !Number.isFinite(Date.parse(data.startedAt)) ||
    !(legacy ? (LEGACY_PROTOCOL_IDS as readonly unknown[]).includes(data.protocolId) : (current ? data.protocolId === OBSERVATION_PROTOCOL.id : v3 ? data.protocolId === V3_PROTOCOL : data.protocolId === V2_PROTOCOL)) ||
    !sequence(data.pointIndices, Array.from({length: count}, (_, i) => i)) || !sequence(data.forecastOrder, LIVE_FORECAST_ORDER) ||
    data.mirrored !== false || data.labelKind !== 'guided_task_not_ground_truth' || data.scope !== 'all_phases_replay_only' ||
    !integer(data.droppedFrames) || !Array.isArray(data.frames) || !data.frames.length || data.frames.length > REPLAY_LIMIT ||
    !Array.isArray(data.markers) || data.markers.length > REPLAY_LIMIT * 2) return fail()
  let stretchNotes: { round: number; trial: number; note: string }[] | undefined
  if (data.schema_version === SCHEMA && data.guideMode !== 'auto' && data.guideMode !== 'manual') return fail()
  if (current) {
    if (!Array.isArray(data.stretchNotes) || data.stretchNotes.length > rounds || (plan?.cycle !== 'stretch' && data.stretchNotes.length)) return fail()
    let lastRound = 0
    stretchNotes = data.stretchNotes.map(n => {
      if (!object(n) || !integer(n.round) || n.round <= lastRound || n.round > rounds || n.trial !== n.round * 2 || typeof n.note !== 'string' || n.note.length > 120) return fail()
      lastRound = n.round
      return { round: n.round, trial: n.trial as number, note: n.note }
    })
  }
  let previous = -1, lastObservation = -1
  const frames: ReplayFrame[] = data.frames.map(f => {
    if (!object(f) || !nonnegative(f.elapsedMs) || f.elapsedMs <= previous || !(f.observationTimeMs === null || nonnegative(f.observationTimeMs) && f.observationTimeMs > lastObservation) ||
      !(f.videoTimeMs === null || nonnegative(f.videoTimeMs)) || !finite(f.width) || !finite(f.height) || f.width <= 0 || f.height <= 0 || f.width > 8192 || f.height > 8192 ||
      !(f.poseModelId === null || text(f.poseModelId)) || data.schema_version === SCHEMA && (!(f.rawObservationTimeMs === null || finite(f.rawObservationTimeMs)) || !(f.rawFeatures === null || object(f.rawFeatures) && ['headGap', 'offset', 'tilt', 'quality'].every(k => finite((f.rawFeatures as Record<string, unknown>)[k])) && (f.rawFeatures.turn === null || finite(f.rawFeatures.turn))) || !(f.inferenceMs === null || nonnegative(f.inferenceMs)) || ![null, 'CPU', 'GPU'].includes(f.delegate as never) || ![null, 'seen', 'grace', 'missing'].includes(f.shoulders as never)) || !REPLAY_PHASES.includes(f.phase as ReplayPhase) || !tasks.includes(String(f.task)) ||
      !(f.round === null || integer(f.round) && f.round >= 1 && f.round <= rounds) || !(f.trial === null || integer(f.trial) && f.trial >= 1 && f.trial <= trials) ||
      !integer(f.attempt) || !integer(f.segment) || typeof f.measurement !== 'boolean' || f.measurement && f.phase !== 'hold') return fail()
    previous = f.elapsedMs
    if (f.observationTimeMs !== null) lastObservation = f.observationTimeMs as number
    const image = readPoints(f.image, count), world = readPoints(f.world, count)
    if (data.schema_version !== SCHEMA && f.observationTimeMs === null && [...image,...world].some(p => p !== null)) return fail()
    return { elapsedMs: f.elapsedMs, observationTimeMs: f.observationTimeMs, videoTimeMs: f.videoTimeMs, width: f.width, height: f.height,
      poseModelId: f.poseModelId, phase: f.phase, task: f.task, round: f.round, trial: f.trial, attempt: f.attempt, segment: f.segment,
      measurement: f.measurement, ...(data.schema_version === SCHEMA ? { rawObservationTimeMs: f.rawObservationTimeMs, rawFeatures: f.rawFeatures, inferenceMs: f.inferenceMs, delegate: f.delegate, shoulders: f.shoulders } : {}), image, world } as ReplayFrame
  })
  let markerTime = -1, markerFrame = -1
  const markers: ReplayMarker[] = data.markers.map(m => {
    if (!object(m) || !nonnegative(m.elapsedMs) || m.elapsedMs < markerTime || !integer(m.afterFrame) || m.afterFrame < markerFrame || m.afterFrame >= frames.length ||
      m.elapsedMs < frames[m.afterFrame].elapsedMs || !['hidden','interrupted','stopped'].includes(String(m.reason))) return fail()
    markerTime = m.elapsedMs; markerFrame = m.afterFrame
    return { elapsedMs: m.elapsedMs, afterFrame: m.afterFrame, reason: m.reason as ReplayMarker['reason'] }
  })
  return { schema_version: legacy ? LEGACY_SCHEMA : data.schema_version === SCHEMA ? SCHEMA : data.schema_version === V4_SCHEMA ? V4_SCHEMA : v3 ? V3_SCHEMA : V2_SCHEMA, source: data.source as 'camera' | 'synthetic', runId: data.runId, startedAt: data.startedAt,
    protocolId: data.protocolId as ObservationReplayData['protocolId'], plan, ...(data.schema_version === SCHEMA ? { guideMode: data.guideMode as 'auto' | 'manual' } : {}), ...(stretchNotes ? { stretchNotes } : {}), pointIndices: Array.from({length: count}, (_, i) => i), forecastOrder: [...LIVE_FORECAST_ORDER], mirrored: false,
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
  link.href = url; link.download = `posture-full-${data.source}-${Date.now()}.json`
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
