import type { Draft, RecordItem } from '../storage/types'

/** Checkpoints stay synchronous; an acknowledged result can be saved remotely without changing its body. */
export type SessionRepository = {
  readDraft: () => Draft | null
  readRecords: () => RecordItem[]
  saveDraft: (draft: Draft) => void
  removeDraft: (id: string) => void
  readPending: () => RecordItem | null
  rememberPending: (record: RecordItem) => void
  forgetPending: (id: string) => void
  saveRecord: (record: RecordItem) => Promise<RecordItem[]>
}
