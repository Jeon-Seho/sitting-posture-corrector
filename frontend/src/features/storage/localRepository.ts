import { DEFAULT_RULES } from '../../data/posture'
import { KEYS, type Draft, type Profile, type RecordItem } from './types'
import { validLocal } from './validation'

const labels: Record<string, string> = {
  [KEYS.profile]: '프로필',
  [KEYS.records]: '측정 기록',
  [KEYS.draft]: '중간 기록',
  [KEYS.settings]: '설정',
  [KEYS.demo]: '시연 옵션',
}
export function readLocal<T>(key: string, fallback: T): T {
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    throw new Error(`${labels[key]} 저장소에 접근하지 못했습니다.`)
  }
  if (raw === null) return fallback
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!validLocal(key, parsed)) throw new Error('Invalid local data')
    return parsed as T
  } catch {
    throw new Error(`${labels[key]} 자료를 읽을 수 없습니다. 기존 자료는 유지됩니다.`)
  }
}
export function writeLocal(key: string, value: unknown) {
  // A failed read must never turn damaged data into an empty overwrite.
  readLocal(key, null)
  if (!validLocal(key, value)) throw new Error(`${labels[key]} 값이 올바르지 않습니다.`)
  localStorage.setItem(key, JSON.stringify(value))
}
export function saveDraft(draft: Draft) {
  const previous = readLocal<Draft | null>(KEYS.draft, null)
  if (previous && previous.id !== draft.id)
    throw new Error('다른 중간 기록이 있습니다. 먼저 복구하거나 종료해 주세요.')
  writeLocal(KEYS.draft, draft)
}
export function removeSavedDraft(id: string) {
  const draft = readLocal<Draft | null>(KEYS.draft, null)
  if (draft?.id === id) localStorage.removeItem(KEYS.draft)
}
export function loadLocalState() {
  const issues: string[] = []
  const read = <T>(key: string, fallback: T): T => {
    try {
      return readLocal(key, fallback)
    } catch (e) {
      issues.push((e as Error).message)
      return fallback
    }
  }
  const profile = read<Profile | null>(KEYS.profile, null),
    records = read<RecordItem[]>(KEYS.records, [])
  const draft = read<Draft | null>(KEYS.draft, null),
    settings = read(KEYS.settings, DEFAULT_RULES),
    demo = read(KEYS.demo, false)
  return {
    profile,
    records,
    draft: draft && !records.some((r) => r.id === draft.id) ? draft : null,
    settings,
    demo,
    issues,
  }
}
