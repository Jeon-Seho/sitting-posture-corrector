import type { Draft, RecordItem } from '../storage/types'
import { validDraft, validRecord } from '../storage/validation'
import { validUuid } from '../session/server/validation'

/** Temporary retry material belongs to one authenticated account and one browser tab. */
export function accountDraftStorage(userId: string, storage?: Storage) {
  if (!validUuid(userId)) throw new Error('계정 식별자를 확인하지 못했습니다.')
  const prefix = `posegood.account.v1.${userId}`
  const keys = { draft: `${prefix}.draft`, pending: `${prefix}.pending-result` }
  // Access can be denied by browser policy. Callers show a read-only notice instead of failing render.
  const backend = () => storage ?? sessionStorage

  function read<T>(key: string, validate: (value: unknown) => value is T): T | null {
    const raw = backend().getItem(key)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (!validate(value)) throw new Error('중간 자료를 읽지 못했습니다. 기존 자료는 유지됩니다.')
    return value
  }

  return {
    keys,
    readDraft: () => read(keys.draft, validDraft),
    readPending: () => read(keys.pending, validRecord),
    saveDraft(draft: Draft) {
      const previous = read(keys.draft, validDraft)
      if (!validDraft(draft) || (previous && previous.id !== draft.id))
        throw new Error('다른 중간 측정을 먼저 종료하거나 복구해 주세요.')
      backend().setItem(keys.draft, JSON.stringify(draft))
    },
    rememberPending(record: RecordItem) {
      const previous = read(keys.pending, validRecord)
      if (!validRecord(record) || (previous && previous.id !== record.id))
        throw new Error('이전 결과의 저장을 먼저 확인해 주세요.')
      backend().setItem(keys.pending, JSON.stringify(record))
    },
    removeDraft(id: string) {
      if (read(keys.draft, validDraft)?.id === id) backend().removeItem(keys.draft)
    },
    forgetPending(id: string) {
      if (read(keys.pending, validRecord)?.id === id) backend().removeItem(keys.pending)
    },
    clear() {
      backend().removeItem(keys.draft)
      backend().removeItem(keys.pending)
    },
  }
}
