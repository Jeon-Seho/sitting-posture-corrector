import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { CameraController } from '../../hooks/useCamera'
import { readLocal, writeLocal } from '../storage/localRepository'
import { upsertRecord } from '../storage/records'
import { KEYS, type RecordItem } from '../storage/types'
import type { LocalWorkspace } from '../storage/useLocalWorkspace'
import type { ServiceSession } from './types'
import type { LiveState } from './live/LiveSession'
import { collapseEvents } from './live/events'
import { policyFor } from './live/useLiveSession'
import { validSessionView } from './server/validation'
import { serverRecordEvents } from '../storage/serverSnapshots'
import type { SessionView } from './server/contracts'

/**
 * A record's start and end as the server set them (ADR 0029): `ready.started_at` and
 * `closed.ended_at`. Without `closed` (lost connection, result fetched by S4) the end is the server
 * start plus the server's measured total, which is how the server stores it too. Only while the
 * server does not send these fields yet (FE proposal BE-6) does this computer's clock stand in.
 */
export function recordTimes(state: Pick<LiveState, 'startedAt' | 'endedAt' | 'summary'>, localStart: string) {
  const startedAt = state.startedAt ?? localStart
  const endedAt =
    state.endedAt ??
    (state.startedAt ? new Date(Date.parse(state.startedAt) + state.summary.total_ms).toISOString() : new Date().toISOString())
  return { startedAt, endedAt }
}
import { DailyMeasurementLedger } from '../storage/dailyMeasurement'

/** The server's running totals in seconds, as the day split (`DailyMeasurementLedger`) reads them. */
function dayTotals(state: LiveState) {
  const alerts = state.events.filter((e) => e.kind === 'collapse_confirmed' || e.kind === 'reminder')
  return {
    total: state.summary.total_ms / 1000,
    valid: state.summary.valid_ms / 1000,
    good: state.summary.normal_ms / 1000,
    events: collapseEvents(state.events),
    lastAlertAt: alerts.length ? alerts[alerts.length - 1].timestamp_ms / 1000 : undefined,
  }
}

type Options = {
  session: ServiceSession | null
  setSession: Dispatch<SetStateAction<ServiceSession | null>>
  ended: MutableRefObject<boolean>
  workspace: LocalWorkspace
  camera: CameraController
  go: (page: 'home' | 'session') => void
  setError: (message: string) => void
}

/**
 * Starts a server measurement and keeps its result for the 기록 screens.
 *
 * The server stores every measurement (S1…`end`, a lost connection included); nothing is
 * resumed or resent here (ADR 0024). The confirmed summary is also kept on this device: the
 * 기록 screens show today from these copies even after they read R1·T1 for earlier days
 * (ADR 0027). One key for every account on this device, by choice (ADR 0027).
 */
export function useSessionPersistence({ session, setSession, ended, workspace, camera, go, setError }: Options) {
  const { rules, setRecords } = workspace
  const pending = useRef<RecordItem | null>(null)
  const measuring = !!session && !ended.current
  // A measurement over KST midnight is kept per day as well (PR #64 ADR 0025): the server's running
  // totals are split at each midnight as they arrive. Once the server ends measurements at
  // midnight (ADR 0029, BE-6) there is only ever one day.
  const daily = useRef<{ id: string; ledger: DailyMeasurementLedger } | null>(null)

  /** The server's running totals for the day split (every `progress`). */
  function observe(state: LiveState) {
    if (!session || ended.current || state.summary.total_ms === 0) return
    dayLedger(state)?.observe(dayTotals(state))
  }

  function dayLedger(state: LiveState) {
    if (!session) return null
    if (daily.current?.id !== session.id) {
      // Days are counted from the server's start; wait for `ready.started_at` (ADR 0029).
      if (!state.startedAt) return null
      daily.current = { id: session.id, ledger: new DailyMeasurementLedger(state.startedAt) }
    }
    return daily.current.ledger
  }

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!measuring) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [measuring])

  function start() {
    if (session && !ended.current) {
      go('session')
      return
    }
    // Results are still copied to this device for the 기록 screens (see above).
    if (!workspace.requireWriter()) return
    if (camera.state !== 'on' || !camera.quality || camera.progress !== null || camera.registering) {
      setError('카메라 연결과 기준 등록을 완료한 뒤 시작해 주세요.')
      return
    }
    if (!camera.calibrationId) {
      setError('기준 자세가 없어요. 자세를 먼저 등록해 주세요.')
      return
    }
    ended.current = false
    setSession({
      id: crypto.randomUUID(),
      // Stand-in until `ready.started_at` arrives; the record uses the server's (recordTimes).
      startedAt: new Date().toISOString(),
      rules: { ...rules },
      baselineId: camera.calibrationId,
    })
    go('session')
  }

  /** The measurement is over; `note` tells why when the user did not end it. */
  function finish(state: LiveState, note: string) {
    if (!session || ended.current) return
    ended.current = true
    if (note) setError(note)
    // Nothing was measured (S1 or the connection failed): there is no record.
    if (state.phase === 'failed' || state.summary.total_ms === 0) return
    // The same shape R1 returns (BE api-spec RecordItem): the server's SessionView in `server`.
    const view = {
      schema_version: '1.0',
      session_id: session.id,
      policy: policyFor(session.rules),
      timer_policy: 'legacy-interrupt-v1',
      ended: state.events.some((e) => e.kind === 'session_ended'),
      last_sequence: state.lastSequence,
      summary: state.summary,
      events: state.events.map((e) => ({
        schema_version: '1.0',
        session_id: session.id,
        event_id: e.event_id,
        kind: e.kind,
        timestamp_ms: e.timestamp_ms,
        onset_ms: e.onset_ms,
        onset_valid_ms: e.onset_valid_ms,
        deviation_type: e.deviation_type,
        reason: e.reason,
      })),
    }
    // A lost connection is saved by the server too, but the app did not see it confirmed.
    const confirmed = !state.lost && view.ended
    const checked = validSessionView(view, session.id, session.rules) ? (view as SessionView) : null
    const times = recordTimes(state, session.startedAt)
    const ledger = dayLedger(state)
    ledger?.observe(dayTotals(state))
    const days = ledger?.snapshot()
    const record: RecordItem = {
      id: session.id,
      startedAt: times.startedAt,
      endedAt: times.endedAt,
      mode: 'camera',
      rules: session.rules,
      valid: state.summary.valid_ms / 1000,
      good: state.summary.normal_ms / 1000,
      total: state.summary.total_ms / 1000,
      events: checked ? serverRecordEvents(checked, confirmed) : collapseEvents(state.events).filter((e) => e.endAt !== null),
      // Only the days of this record's own start (the split counts from the server start).
      ...(days && times.startedAt === state.startedAt ? { days } : {}),
      ...(checked
        ? {
            server: {
              baselineId: session.baselineId,
              modelVersion: state.observation?.model_version ?? 'unmeasured',
              confirmed,
              view: checked,
            },
          }
        : {}),
    }
    try {
      const next = upsertRecord(readLocal<RecordItem[]>(KEYS.records, []), record)
      writeLocal(KEYS.records, next)
      setRecords(next)
    } catch {
      setError('서버에는 저장됐지만 이 기기의 기록 화면에 넣지 못했어요.')
    }
  }

  function clearSession() {
    setSession(null)
    pending.current = null
  }

  return { start, finish, observe, clearSession, pending }
}
