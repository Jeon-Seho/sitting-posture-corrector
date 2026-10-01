import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { CameraController } from '../../hooks/useCamera'
import type { LiveState, Machine } from '../../lib/engine'
import { readLocal, writeLocal, saveDraft, removeSavedDraft } from '../storage/localRepository'
import { upsertRecord, recordFromDraft, resumeMachine } from '../storage/records'
import { KEYS, type Draft, type RecordItem } from '../storage/types'
import type { LocalWorkspace } from '../storage/useLocalWorkspace'
import type { ServiceSession } from './types'
import type { ServerCheckpoint, SessionView } from './server/contracts'
import { serverRecordEvents } from '../storage/serverSnapshots'

type Options = {
  session: ServiceSession | null
  setSession: Dispatch<SetStateAction<ServiceSession | null>>
  ended: MutableRefObject<boolean>
  workspace: LocalWorkspace
  camera: CameraController
  registration: boolean
  onRegistrationComplete: () => void
  go: (page: 'home' | 'session') => void
  setError: (message: string) => void
  serverMode?: boolean
}

/** Persists checkpoints/results and retries the same immutable result after a failure. */
export function useSessionPersistence({
  session,
  setSession,
  ended,
  workspace,
  camera,
  registration,
  onRegistrationComplete,
  go,
  setError,
  serverMode = false,
}: Options) {
  const { rules, draft, setDraft, setRecords, requireWriter, writable, reloadStorage } = workspace
  const pending = useRef<RecordItem | null>(null)
  const [saveMessage, setSaveMessage] = useState('이 브라우저에 결과를 저장하고 있습니다.')
  const measuring = !!session && !ended.current

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!measuring && !pending.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [measuring])

  function start() {
    if (!requireWriter()) return
    if (pending.current) {
      setError('이전 결과 저장을 완료한 뒤 새 측정을 시작해 주세요.')
      return
    }
    if (session && !ended.current) {
      go('session')
      return
    }
    try {
      const saved = readLocal<Draft | null>(KEYS.draft, null)
      if (saved && !readLocal<RecordItem[]>(KEYS.records, []).some((r) => r.id === saved.id)) {
        setDraft(saved)
        setError('중단된 측정을 이어하거나 종료·저장한 뒤 새 측정을 시작해 주세요.')
        return
      }
    } catch (cause) {
      setError((cause as Error).message)
      reloadStorage()
      return
    }
    if (camera.state !== 'on' || !camera.baseline || !camera.quality || camera.progress !== null) {
      setError('카메라 연결과 기준 등록을 완료한 뒤 시작해 주세요.')
      return
    }
    if (registration) {
      onRegistrationComplete()
      go('home')
      return
    }
    const video = camera.videoRef.current
    if (serverMode && (!camera.calibrationId || !video?.videoWidth || !video.videoHeight)) {
      setError('서버 측정에 사용할 카메라 영상과 기준 등록을 다시 확인해 주세요.')
      return
    }
    // New sessions use the real webcam; existing synthetic records/drafts remain available.
    const next = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      mode: 'camera' as const,
      rules: { ...rules },
      ...(serverMode
        ? {
            server: {
              baselineId: camera.calibrationId!,
              baseline: { ...camera.baseline },
              deviceId: camera.deviceId,
              frameWidth: video!.videoWidth,
              frameHeight: video!.videoHeight,
            },
          }
        : {}),
    }
    ended.current = false
    pending.current = null
    setSaveMessage('저장 대기')
    setSession(next)
    go('session')
  }
  function saveResult(record: RecordItem) {
    pending.current = record
    if (!requireWriter()) {
      setSaveMessage('결과는 유지됩니다. 저장소 안내를 확인한 뒤 저장 다시 시도를 눌러 주세요.')
      return
    }
    try {
      const next = upsertRecord(readLocal<RecordItem[]>(KEYS.records, []), record)
      writeLocal(KEYS.records, next)
      setRecords(next)
      setDraft((old) => (old?.id === record.id ? null : old))
      pending.current = null
      setSaveMessage('이 브라우저에 저장했습니다. 홈과 대시보드에 반영되었습니다.')
      try {
        removeSavedDraft(record.id)
      } catch {
        setError(
          '결과는 저장했습니다. 중간 기록 정리에 실패했지만 같은 세션을 다시 측정하지 않습니다.',
        )
      }
    } catch {
      pending.current = record
      setSaveMessage(
        '저장하지 못했습니다. 결과는 유지됩니다. 자동 재시도하거나 저장 다시 시도를 눌러 주세요.',
      )
    }
  }
  useEffect(() => {
    const timer = setInterval(() => {
      if (pending.current) saveResult(pending.current)
    }, 5000)
    return () => clearInterval(timer)
  }, [])
  function finish(
    live: Pick<LiveState, 'validSeconds' | 'goodSeconds' | 'totalSeconds' | 'events'> & {
      modelVersion?: string | null
      view?: SessionView | null
    },
    serverConfirmed = true,
  ) {
    if (!session) return
    ended.current = true
    saveResult({
      id: session.id,
      startedAt: session.startedAt,
      endedAt: new Date().toISOString(),
      mode: session.mode,
      rules: session.rules,
      valid: live.validSeconds,
      good: live.goodSeconds,
      total: live.totalSeconds,
      events: session.server ? serverRecordEvents(live.view ?? null, serverConfirmed) : live.events,
      ...(session.server
        ? {
            server: {
              baselineId: session.server.baselineId,
              modelVersion: live.modelVersion ?? 'unmeasured',
              confirmed: serverConfirmed,
              view: live.view ? structuredClone(live.view) : null,
            },
          }
        : {}),
    })
  }
  function archiveServerResult(
    live: Pick<LiveState, 'validSeconds' | 'goodSeconds' | 'totalSeconds' | 'events'> & {
      modelVersion?: string | null
      view?: SessionView | null
    },
  ) {
    // Archive only acknowledged time. This is not an acknowledgement of remote termination.
    finish(live, false)
  }
  function checkpoint(machine: Machine, server?: ServerCheckpoint): boolean {
    if (!session || ended.current) return false
    if (!writable.current) {
      setError('중간 기록을 저장할 수 없습니다. 새로고침 시 기록을 잃을 수 있습니다.')
      return false
    }
    try {
      saveDraft({
        id: session.id,
        startedAt: session.startedAt,
        mode: session.mode,
        rules: session.rules,
        savedAt: new Date().toISOString(),
        machine,
        ...(server ? { server } : {}),
      })
      return true
    } catch {
      setError('중간 기록을 저장하지 못했습니다. 새로고침 시 기록을 잃을 수 있습니다.')
      return false
    }
  }
  function restore() {
    if (!draft || !requireWriter()) return
    ended.current = false
    setSession(
      draft.server
        ? {
            id: draft.id,
            startedAt: draft.startedAt,
            mode: draft.mode,
            rules: draft.rules,
            server: {
              baselineId: draft.server.baselineId,
              baseline: draft.server.baseline,
              deviceId: draft.server.deviceId,
              frameWidth: draft.server.frameWidth,
              frameHeight: draft.server.frameHeight,
              checkpoint: draft.server,
            },
          }
        : { ...draft, initial: resumeMachine(draft.machine) },
    )
    setDraft(null)
    go('session')
  }

  function finishDraft() {
    if (!draft) return
    if (draft.server) {
      if (!requireWriter()) return
      ended.current = false
      setSession({
        id: draft.id,
        startedAt: draft.startedAt,
        mode: draft.mode,
        rules: draft.rules,
        server: {
          baselineId: draft.server.baselineId,
          baseline: draft.server.baseline,
          deviceId: draft.server.deviceId,
          frameWidth: draft.server.frameWidth,
          frameHeight: draft.server.frameHeight,
          checkpoint: draft.server,
          finishOnly: true,
        },
      })
      setDraft(null)
      go('session')
      return
    }
    saveResult(pending.current ?? recordFromDraft(draft, draft.savedAt ?? new Date().toISOString()))
  }

  function retrySave() {
    if (pending.current) saveResult(pending.current)
  }

  function clearSession() {
    setSession(null)
    pending.current = null
  }

  return {
    start,
    finish,
    archiveServerResult,
    checkpoint,
    restore,
    finishDraft,
    retrySave,
    clearSession,
    pending,
    saveMessage,
  }
}
