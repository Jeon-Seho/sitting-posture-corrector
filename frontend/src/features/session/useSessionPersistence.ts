import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { CameraController } from '../../hooks/useCamera'
import type { LocalWorkspace } from '../storage/useLocalWorkspace'
import type { ServiceSession } from './types'
import type { LiveState } from './live/LiveSession'
import { getServerAuth, subscribeServerAuth } from '../platform/serverAuth'
import { clearPageError, reportPageError } from '../connection/pageError'
import { dropOldPendingResults, fetchServerRecords, settleUnconfirmed } from '../storage/serverRecords'

/** Measurements the server lost (S4 404 while checking them); the same reason as the S4 404 page. */
export const LOST_RESULTS = '사용자 잘못이 아니에요. 서버 문제로 지난 측정이 기록에 남지 않았어요.'

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
 * Records are the server's (R1) only; nothing about a measurement is kept on this device
 * (ADR 0027, 11/13). Coordinates go to the server as they are measured, so a measurement the
 * server did not store is an unintended fault. A measurement that ended without the server's
 * confirmation (lost connection, late result) is remembered in memory while the app is open: R1
 * or S4 settles it, and when the server lost it (S4 404) the user is told once.
 */
export function useSessionPersistence({ session, setSession, ended, workspace, camera, go, setError }: Options) {
  const { rules, setRecords } = workspace
  const unconfirmed = useRef<string[]>([])
  const measuring = !!session && !ended.current
  const owner = useRef<string | null>(getServerAuth()?.userId ?? null)
  const latest = useRef({ measuring, setRecords, setError })
  latest.current = { measuring, setRecords, setError }
  const syncing = useRef(false)
  async function syncRecords() {
    const userId = getServerAuth()?.userId
    if (!userId || syncing.current || latest.current.measuring) return
    syncing.current = true
    try {
      const records = await fetchServerRecords(userId)
      if (getServerAuth()?.userId !== userId) return
      latest.current.setRecords(records)
      clearPageError('records')
      if (unconfirmed.current.length) {
        const { remaining, lost } = await settleUnconfirmed(userId, unconfirmed.current, records)
        if (getServerAuth()?.userId !== userId) return
        unconfirmed.current = remaining
        if (lost) latest.current.setError(LOST_RESULTS)
      }
    } catch (error) {
      console.error('[features/session/useSessionPersistence.ts:syncRecords] Operation failed', error)
      if (getServerAuth()?.userId !== userId) return
      latest.current.setError(error instanceof Error ? error.message : '기록을 확인하지 못했어요.')
      reportPageError('records', error, () => void syncRecords())
    } finally { syncing.current = false }
  }
  useEffect(() => {
    const changed = () => {
      const userId = getServerAuth()?.userId ?? null
      if (owner.current !== userId) {
        owner.current = userId
        unconfirmed.current = []
        latest.current.setRecords([])
      }
      if (userId) {
        dropOldPendingResults(userId)
        void syncRecords()
      }
    }
    changed()
    const unsubscribe = subscribeServerAuth(changed)
    const timer = setInterval(() => { if (!latest.current.measuring) void syncRecords() }, 15000)
    return () => { unsubscribe(); clearInterval(timer) }
  }, [])

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!measuring) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [measuring])

  /** Starts a measurement; false when something has to be fixed first (the reason is shown). */
  function start(): boolean {
    if (!getServerAuth()) {
      setError('개발자 계정은 화면 확인용이에요. 서버 측정은 일반 계정으로 로그인해 주세요.')
      return false
    }
    if (session && !ended.current) {
      go('session')
      return true
    }
    if (!workspace.requireWriter()) return false
    if (camera.state !== 'on' || !camera.quality || camera.progress !== null || camera.registering) {
      setError('카메라 연결과 기준 등록을 완료한 뒤 시작해 주세요.')
      return false
    }
    if (!camera.calibrationId) {
      setError('기준 자세가 없어요. 설정에서 자세를 등록해 주세요.')
      return false
    }
    ended.current = false
    setSession({
      id: crypto.randomUUID(),
      // Stand-in until `ready.started_at` arrives; records come from the server (R1).
      startedAt: new Date().toISOString(),
      rules: { ...rules },
      baselineId: camera.calibrationId,
    })
    go('session')
    return true
  }

  /** The measurement is over; `note` tells why when the user did not end it. */
  function finish(state: LiveState, note: string) {
    if (!session || ended.current) return
    ended.current = true
    latest.current.measuring = false
    if (note) setError(note)
    // S4 404 at the end has its own error page; nothing to check later.
    if (state.resultMissing) return
    // Measured, but the server did not confirm it stored it (`closed(ended)`): check it later.
    const confirmed = !state.lost && state.events.some((e) => e.kind === 'session_ended')
    if (state.phase !== 'failed' && state.summary.total_ms > 0 && !confirmed) {
      unconfirmed.current = [...unconfirmed.current.filter((id) => id !== state.sessionId), state.sessionId]
    }
    void syncRecords()
  }

  function clearSession() {
    setSession(null)
  }

  return { start, finish, clearSession, syncRecords }
}
