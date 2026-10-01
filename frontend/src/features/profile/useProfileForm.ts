import { useState } from 'react'
import { KEYS, type Profile } from '../storage/types'
import { validProfile } from '../storage/validation'
import { writeLocal } from '../storage/localRepository'
import type { LocalWorkspace } from '../storage/useLocalWorkspace'

type Options = {
  workspace: LocalWorkspace
  measuring: boolean
  hasPendingResult: () => boolean
  setError: (message: string) => void
  onWithdrawn: () => void
}

export function useProfileForm({
  workspace,
  measuring,
  hasPendingResult,
  setError,
  onWithdrawn,
}: Options) {
  const { profile, requireWriter, reloadStorage, setProfile } = workspace
  const [name, setName] = useState(profile?.name ?? '')
  const [age, setAge] = useState(profile?.age ?? 23)
  const [occupation, setOccupation] = useState(profile?.occupation ?? '')
  const [consent, setConsent] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function resetFields(source: Profile | null = profile) {
    setName(source?.name ?? '')
    setAge(source?.age ?? 23)
    setOccupation(source?.occupation ?? '')
  }

  function saveProfile(notify = true) {
    if (!requireWriter()) return false
    const next = { name: name.trim(), age, occupation: occupation.trim() }
    if (!validProfile(next)) {
      setError('이름·나이·직업을 확인해 주세요. 나이는 1~120 사이의 정수로 입력해 주세요.')
      return false
    }
    try {
      writeLocal(KEYS.profile, next)
      setProfile(next)
      setError(notify ? '저장했습니다.' : '')
      return true
    } catch {
      setError('브라우저에 저장하지 못했습니다. 저장 공간과 권한을 확인해 주세요.')
      return false
    }
  }

  function cancelEditing() {
    resetFields()
    setError('변경을 취소했습니다.')
  }

  function cancelWithdrawal() {
    setDeleting(false)
    setConsent(false)
  }

  function withdraw() {
    if (!requireWriter() || measuring || hasPendingResult()) return
    try {
      // Keep the profile until the other keys are removed, so partial failure stays visible.
      for (const key of [KEYS.records, KEYS.draft, KEYS.settings, KEYS.demo, KEYS.profile]) {
        localStorage.removeItem(key)
      }
      onWithdrawn()
      setName('')
      setOccupation('')
      setAge(23)
      setDeleting(false)
      setConsent(false)
      setConfirmDelete(false)
      setError('이 브라우저의 사용자 자료를 삭제했습니다.')
    } catch {
      setConfirmDelete(false)
      reloadStorage()
      setError('자료를 모두 삭제하지 못했습니다. 남은 자료를 다시 확인한 뒤 시도해 주세요.')
    }
  }

  return {
    name,
    age,
    occupation,
    setName,
    setAge,
    setOccupation,
    consent,
    setConsent,
    deleting,
    setDeleting,
    confirmDelete,
    setConfirmDelete,
    resetFields,
    saveProfile,
    cancelEditing,
    cancelWithdrawal,
    withdraw,
  }
}

export type ProfileForm = ReturnType<typeof useProfileForm>
