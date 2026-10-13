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
  /** Age and occupation are kept only with sign-up consent C3. */
  optionalInfo?: boolean
}

export function useProfileForm({
  workspace,
  measuring,
  hasPendingResult,
  setError,
  onWithdrawn,
  optionalInfo = true,
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
    const next: Profile = optionalInfo
      ? { name: name.trim(), age, occupation: occupation.trim() }
      : { name: name.trim() }
    if (!validProfile(next)) {
      setError(
        optionalInfo
          ? '이름·나이·직업을 확인해 주세요. 나이는 1~120 사이의 정수로 입력해 주세요.'
          : '이름을 확인해 주세요.',
      )
      return false
    }
    try {
      writeLocal(KEYS.profile, next)
      setProfile(next)
      setError(notify ? '저장했어요.' : '')
      return true
    } catch {
      setError('저장하지 못했어요. 저장 공간과 권한을 확인해 주세요.')
      return false
    }
  }

  function cancelEditing() {
    resetFields()
    setError('변경을 취소했어요.')
  }

  function cancelWithdrawal() {
    setDeleting(false)
    setConsent(false)
  }

  function withdraw() {
    if (!requireWriter() || measuring || hasPendingResult()) return
    try {
      // Keep the profile until the other keys are removed, so partial failure stays visible.
      for (const key of [KEYS.records, KEYS.draft, KEYS.settings, KEYS.demo, KEYS.account, KEYS.profile]) {
        localStorage.removeItem(key)
      }
      onWithdrawn()
      setName('')
      setOccupation('')
      setAge(23)
      setDeleting(false)
      setConsent(false)
      setConfirmDelete(false)
      setError('이 기기의 사용자 자료를 삭제했어요.')
    } catch {
      setConfirmDelete(false)
      reloadStorage()
      setError('자료를 모두 삭제하지 못했어요. 남은 자료를 확인한 뒤 다시 시도해 주세요.')
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
