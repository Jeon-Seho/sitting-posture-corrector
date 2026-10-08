import { useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { useWriterLock } from '../../hooks/useWriterLock'
import type { AccountWorkspace, WorkspaceUpdate } from './contracts'
import { accountClient, accountError } from './client'
import { accountDraftStorage } from './draftStorage'
import { upsertRecord } from '../storage/records'
import type { LocalWorkspace } from '../storage/useLocalWorkspace'
import type { Profile } from '../storage/types'
import type { SessionRepository } from '../session/repository'

/** DB schema V1.1 has no column for it, so the demo toggle stays on this device per account. */
function demoPreference(userId: string) {
  const key = `posegood.account.v1.${userId}.show-demo`
  return {
    read() {
      try {
        return localStorage.getItem(key) === 'true'
      } catch {
        return false
      }
    },
    save(value: boolean) {
      try {
        localStorage.setItem(key, String(value))
      } catch {
        /* Browser policy may deny storage; the toggle still applies to this page. */
      }
    },
  }
}

export function useRemoteWorkspace(
  userId: string,
  initial: AccountWorkspace,
  onError: (message: string) => void,
) {
  const writer = useWriterLock()
  const storage = useMemo(() => accountDraftStorage(userId), [userId])
  const [loaded] = useState(() => {
    try {
      return { draft: storage.readDraft(), pending: storage.readPending(), issues: [] as string[] }
    } catch {
      return {
        draft: null,
        pending: null,
        issues: ['이 탭의 중간 자료를 읽지 못했습니다. 원본은 유지합니다.'],
      }
    }
  })
  const [profile, setProfile] = useState<Profile | null>(initial.profile)
  const [rules, setRules] = useState(initial.rules)
  const demo = useMemo(() => demoPreference(userId), [userId])
  const [showDemo, setDemoState] = useState(demo.read)
  const [alertsOn, setAlertsOn] = useState(initial.preferences.alerts_on)
  const [records, setRecords] = useState(initial.records)
  const [draft, setDraft] = useState(loaded.draft)
  const [storageIssues, setStorageIssues] = useState(loaded.issues)
  const [saving, setSaving] = useState(false)
  const writable = useRef(false)
  writable.current = writer.state === 'ready' && storageIssues.length === 0
  const alive = useRef(true)
  const latest = useRef(initial)
  const recordList = useRef(records)
  recordList.current = records
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pendingUpdates = useRef(0)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  function requireWriter() {
    if (writable.current) return true
    onError('저장 권한과 중간 자료 안내를 확인해 주세요.')
    return false
  }

  function adopt(value: AccountWorkspace) {
    latest.current = value
    setProfile(value.profile)
    setRules(value.rules)
    setAlertsOn(value.preferences.alerts_on)
    setRecords(value.records)
  }

  function enqueue<T>(action: () => Promise<T>): Promise<T> {
    const request = queue.current
      .catch(() => {})
      .then(() => {
        if (!alive.current) throw new Error('계정 화면을 떠났습니다.')
        accountClient.assertIdentity(userId)
        return action()
      })
    queue.current = request
    return request
  }

  function update(patch: Partial<WorkspaceUpdate>) {
    if (!requireWriter()) return Promise.reject(new Error('저장 권한을 확인해 주세요.'))
    pendingUpdates.current++
    setSaving(true)
    const request = enqueue(async () => {
      const old = latest.current
      const value = await accountClient.updateWorkspace({
        profile: patch.profile ?? old.profile,
        rules: patch.rules ?? old.rules,
        preferences: patch.preferences ?? old.preferences,
      })
      if (alive.current) adopt(value)
    })
    return request
      .catch((error: unknown) => {
        if (alive.current) onError(accountError(error))
        throw error
      })
      .finally(() => {
        pendingUpdates.current--
        if (alive.current) setSaving(pendingUpdates.current > 0)
      })
  }

  function reloadStorage() {
    try {
      setDraft(storage.readDraft())
      storage.readPending()
      setStorageIssues([])
    } catch {
      setStorageIssues(['이 탭의 중간 자료를 읽지 못했습니다. 원본은 유지합니다.'])
    }
    void enqueue(() => accountClient.workspace())
      .then((value) => {
        if (alive.current) adopt(value)
      })
      .catch((error: unknown) => {
        if (alive.current) onError(accountError(error))
      })
  }

  const repository = useMemo<SessionRepository>(
    () => ({
      readDraft: storage.readDraft,
      readRecords: () => recordList.current,
      saveDraft: storage.saveDraft,
      removeDraft: storage.removeDraft,
      readPending: () => loaded.pending,
      rememberPending: storage.rememberPending,
      forgetPending: storage.forgetPending,
      async saveRecord(record) {
        const saved = await enqueue(() => accountClient.saveRecord(record))
        return upsertRecord(recordList.current, saved)
      },
    }),
    [storage, loaded],
  )

  function setShowDemo(action: SetStateAction<boolean>) {
    setDemoState((previous) => {
      const value = typeof action === 'function' ? action(previous) : action
      demo.save(value)
      return value
    })
  }

  const workspace: LocalWorkspace = {
    writer,
    storageIssues,
    profile,
    rules,
    records,
    showDemo,
    draft,
    canWrite: writable.current,
    writable,
    requireWriter,
    reloadStorage,
    setProfile,
    setRecords,
    setRules,
    setShowDemo,
    setDraft,
  }
  return { workspace, repository, alertsOn, saving, update, storage }
}
