import { useEffect, useRef, useState } from 'react'
import { useWriterLock } from '../../hooks/useWriterLock'
import { KEYS, type Profile } from './types'
import { loadLocalState } from './localRepository'

export function useLocalWorkspace(
  measuring: boolean,
  onError: (message: string) => void,
  onProfileReload: (profile: Profile | null) => void,
) {
  const writer = useWriterLock()
  const [initial] = useState(loadLocalState)
  const [storageIssues, setStorageIssues] = useState(initial.issues)
  const [profile, setProfile] = useState(initial.profile)
  const [records, setRecords] = useState(initial.records)
  const [rules, setRules] = useState(initial.settings)
  const [showDemo, setShowDemo] = useState(initial.demo)
  const [draft, setDraft] = useState(initial.draft)
  const canWrite = writer.state === 'ready' && storageIssues.length === 0
  const writable = useRef(canWrite)
  writable.current = canWrite

  function requireWriter() {
    if (writable.current) return true
    onError('저장소 안내를 확인해 주세요. 자료를 변경하거나 새 측정을 시작할 수 없습니다.')
    return false
  }

  function reloadStorage() {
    const next = loadLocalState()
    setStorageIssues(next.issues)
    setRecords(next.records)
    // Active sessions keep the profile and the policy captured at their start.
    if (!measuring) {
      setProfile(next.profile)
      setRules(next.settings)
      setShowDemo(next.demo)
      setDraft(next.draft)
      onProfileReload(next.profile)
    }
  }

  useEffect(() => {
    function changed(event: StorageEvent) {
      if (event.key === null || Object.values(KEYS).some((key) => key === event.key)) {
        reloadStorage()
      }
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [measuring])

  return {
    writer,
    storageIssues,
    profile,
    records,
    rules,
    showDemo,
    draft,
    canWrite,
    writable,
    requireWriter,
    reloadStorage,
    setProfile,
    setRecords,
    setRules,
    setShowDemo,
    setDraft,
  }
}

export type LocalWorkspace = ReturnType<typeof useLocalWorkspace>
