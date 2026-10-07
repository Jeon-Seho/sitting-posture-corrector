import type { CollapseEvent, Machine, Rules } from '../../lib/engine'
import { KEYS, type Draft, type Profile, type RecordItem } from './types'
import { validServerCheckpoint, validSessionView, validUuid } from '../session/server/validation'
import { projectMachine } from '../session/server/projection'
import { sameSnapshot, serverRecordEvents } from './serverSnapshots'

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const positive = (v: unknown): v is number => finite(v) && v > 0
const nonnegative = (v: unknown): v is number => finite(v) && v >= 0
const integer = (v: unknown): v is number => nonnegative(v) && Number.isSafeInteger(v)
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const mode = (v: unknown) => v === 'camera' || v === 'demo'
const near = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b))

export function validRules(v: unknown): v is Rules {
  return (
    object(v) &&
    positive(v.holdSeconds) &&
    v.holdSeconds <= 10 &&
    positive(v.recoverSeconds) &&
    v.recoverSeconds <= 10 &&
    positive(v.realertSeconds) &&
    v.realertSeconds <= 180 &&
    positive(v.threshold) &&
    v.threshold <= 1
  )
}
export function validProfile(v: unknown): v is Profile {
  return (
    object(v) &&
    text(v.name, 50) &&
    integer(v.age) &&
    v.age >= 1 &&
    v.age <= 120 &&
    text(v.occupation, 80)
  )
}
function validEvent(v: unknown, total: number): v is CollapseEvent {
  if (
    !object(v) ||
    !integer(v.id) ||
    v.id < 1 ||
    !['forwardHead', 'tilt', 'referenceChange'].includes(String(v.type)) ||
    !nonnegative(v.startAt) ||
    !nonnegative(v.confirmedAt) ||
    v.startAt > v.confirmedAt ||
    v.confirmedAt > total + 1e-5 ||
    !(
      v.validStartAt === undefined ||
      (nonnegative(v.validStartAt) && v.validStartAt <= v.startAt + 1e-5)
    ) ||
    !nonnegative(v.durationSec) ||
    !integer(v.alerts) ||
    !integer(v.blockId) ||
    !(v.evaluationScope===undefined||v.evaluationScope==='head'||v.evaluationScope==='upper_body') ||
    typeof v.recovered !== 'boolean' ||
    typeof v.endedBySession !== 'boolean' ||
    ![null, 'paused', 'unknown', 'ended'].includes(v.endReason as null) ||
    !(
      v.firstAlertAt === null ||
      (nonnegative(v.firstAlertAt) &&
        v.firstAlertAt >= v.confirmedAt - 1e-5 &&
        v.firstAlertAt <= total + 1e-5)
    ) ||
    (v.alerts === 0) !== (v.firstAlertAt === null) ||
    !(v.recoverySec === null || nonnegative(v.recoverySec))
  )
    return false
  if (v.endAt === null)
    return (
      !v.recovered &&
      !v.endedBySession &&
      v.endReason === null &&
      v.recoverySec === null &&
      v.durationSec === 0
    )
  return (
    nonnegative(v.endAt) &&
    v.endAt >= v.confirmedAt - 1e-5 &&
    v.endAt <= total + 1e-5 &&
    near(v.durationSec, v.endAt - v.startAt) &&
    (v.recovered
      ? v.endReason === null &&
        !v.endedBySession &&
        (v.firstAlertAt === null
          ? v.recoverySec === null
          : finite(v.recoverySec) && near(v.recoverySec, v.endAt - v.firstAlertAt))
      : v.recoverySec === null &&
        v.endReason !== null &&
        v.endedBySession === (v.endReason === 'ended'))
  )
}
function validEvents(v: unknown, total: number): v is CollapseEvent[] {
  return (
    Array.isArray(v) &&
    v.every((e) => validEvent(e, total)) &&
    new Set(v.map((e) => e.id)).size === v.length
  )
}
export function validMachine(v: unknown): v is Machine {
  if (
    !object(v) ||
    ![
      'loop',
      'total',
      'paused',
      'unknown',
      'good',
      'collapse',
      'hold',
      'recover',
      'lastAlertAt',
    ].every((k) => nonnegative(v[k])) ||
    !integer(v.nextId) ||
    v.nextId < 1 ||
    !integer(v.alertTick) ||
    !integer(v.blockId) ||
    typeof v.interrupted !== 'boolean' ||
    !(v.onsetAt === null || (nonnegative(v.onsetAt) && v.onsetAt <= (v.total as number))) ||
    !validEvents(v.events, v.total as number)
  )
    return false
  const total = v.total as number,
    paused = v.paused as number,
    unknown = v.unknown as number
  if (
    paused + unknown > total + 1e-5 ||
    !validEvaluationCounts(v.evaluationCounts,total-paused-unknown,v.good as number) ||
    !(v.evaluationScope===undefined||v.evaluationScope==='head'||v.evaluationScope==='upper_body') ||
    !near((v.good as number) + (v.collapse as number), Math.max(0, total - paused - unknown)) ||
    (v.lastAlertAt as number) > total + 1e-5 ||
    v.events.some((e) => e.id >= (v.nextId as number) || e.blockId > (v.blockId as number)) ||
    v.events.reduce((n, e) => n + e.alerts, 0) !== v.alertTick
  )
    return false
  const open = v.events.filter((e) => e.endAt === null)
  if (v.active === null) return open.length === 0
  const active = v.active
  return (
    validEvent(active, total) &&
    open.length === 1 &&
    (Object.keys(open[0]) as (keyof CollapseEvent)[]).every((key) => active[key] === open[0][key])
  )
}
export function validRecord(v: unknown): v is RecordItem {
  return (
    object(v) &&
    text(v.id, 128) &&
    date(v.startedAt) &&
    date(v.endedAt) &&
    Date.parse(v.endedAt) >= Date.parse(v.startedAt) &&
    mode(v.mode) &&
    nonnegative(v.total) &&
    nonnegative(v.valid) &&
    nonnegative(v.good) &&
    v.good <= v.valid + 1e-5 &&
    v.valid <= v.total + 1e-5 &&
    validEvaluationCounts(v.evaluationCounts,v.valid,v.good) &&
    validEvents(v.events, v.total) &&
    v.events.every(
      (e) => e.validStartAt === undefined || e.validStartAt <= (v.valid as number) + 1e-5,
    ) &&
    v.events.every((e) => e.endAt !== null) &&
    (v.rules === undefined || validRules(v.rules)) &&
    (v.server === undefined || validServerRecord(v))
  )
}
function validEvaluationCounts(v:unknown,valid:number,good:number):boolean {
  if(v===undefined)return true
  if(!object(v)||Object.keys(v).sort().join(',')!=='head,upper_body')return false
  for(const key of ['head','upper_body']){
    const c=v[key]
    if(!object(c)||!nonnegative(c.valid)||!nonnegative(c.good)||c.good>c.valid+1e-5)return false
  }
  const head=v.head as {valid:number;good:number},body=v.upper_body as {valid:number;good:number}
  return head.valid+body.valid<=valid+1e-5&&head.good+body.good<=good+1e-5
}
function validServerRecord(v: Record<string, unknown>): boolean {
  const server = v.server
  if (
    !object(server) ||
    !validUuid(server.baselineId) ||
    typeof server.modelVersion !== 'string' ||
    !/^[a-z0-9._-]{1,64}$/.test(server.modelVersion) ||
    typeof server.confirmed !== 'boolean' ||
    v.mode !== 'camera' ||
    !validRules(v.rules)
  )
    return false
  const view = server.view
  if (!(view === null || validSessionView(view, v.id as string, v.rules))) return false
  if (server.confirmed && !view?.ended) return false
  return (
    v.total === (view?.summary.total_ms ?? 0) / 1000 &&
    v.valid === (view?.summary.valid_ms ?? 0) / 1000 &&
    v.good === (view?.summary.normal_ms ?? 0) / 1000 &&
    sameSnapshot(v.events, serverRecordEvents(view, server.confirmed))
  )
}
export function validDraft(v: unknown): v is Draft {
  return (
    object(v) &&
    text(v.id, 128) &&
    date(v.startedAt) &&
    mode(v.mode) &&
    validRules(v.rules) &&
    validMachine(v.machine) &&
    (v.server === undefined ||
      (v.mode === 'camera' &&
        validServerCheckpoint(v.server, v.id, v.rules) &&
        sameSnapshot(v.machine, projectMachine(v.server.view)))) &&
    (v.savedAt === undefined ||
      (date(v.savedAt) && Date.parse(v.savedAt) >= Date.parse(v.startedAt)))
  )
}
export function validLocal(key: string, value: unknown) {
  if (key === KEYS.profile) return validProfile(value)
  if (key === KEYS.records)
    return (
      Array.isArray(value) &&
      value.every(validRecord) &&
      new Set(value.map((r) => r.id)).size === value.length
    )
  if (key === KEYS.draft) return validDraft(value)
  if (key === KEYS.settings) return validRules(value)
  if (key === KEYS.demo) return typeof value === 'boolean'
  return false
}
