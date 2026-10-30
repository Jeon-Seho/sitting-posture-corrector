import modelAsset from '../../../model-asset.json'
import type { CalibrationSummary } from '../../../../model/prototype/calibration'
import type { Features } from '../../../../model/prototype/legacyPose'
import type { Observation } from './types'

export type BaselineRecord = {
  schema_version: 'posture-baseline-v1'
  calibration_id: string
  created_at: string
  model_id: string
  label: 'baseline_posture'
  label_source: 'registration_assumption'
  normal_assumed: true
  ground_truth_verified: false
  participant_code: null
  baseline: Features
  summary: CalibrationSummary
  frames: Observation[]
}

export function baselineRecord(id: string, baseline: Features, summary: CalibrationSummary,
  frames: Observation[]): BaselineRecord {
  return structuredClone({
    schema_version: 'posture-baseline-v1', calibration_id: id,
    created_at: new Date().toISOString(), model_id: modelAsset.modelId,
    label: 'baseline_posture', label_source: 'registration_assumption',
    normal_assumed: true, ground_truth_verified: false, participant_code: null,
    baseline, summary, frames,
  })
}

const pending = new Map<string, BaselineRecord>()
const listeners = new Set<() => void>()
let failure = ''
export const archiveError = () => failure
export function subscribeArchive(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function notify() { for (const listener of listeners) listener() }
function openArchive(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('저장소 사용 불가')); return }
    const request = indexedDB.open('posegood-baseline-archive-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('baselines', { keyPath: 'calibration_id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('저장소 열기 차단'))
  })
}

// Failed writes stay in memory for download; never silently report them as persisted.
export async function saveBaseline(record: BaselineRecord): Promise<void> {
  pending.set(record.calibration_id, record)
  notify()
  let db: IDBDatabase | undefined
  try {
    db = await openArchive()
    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction('baselines', 'readwrite')
      transaction.objectStore('baselines').put(record)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    pending.delete(record.calibration_id)
    if (!pending.size) failure = ''
  } catch {
    failure = '기준 자료를 기기에 저장하지 못했습니다. 새로고침 전에 내려받아 주세요.'
  } finally { db?.close(); notify() }
}

export async function listBaselines(): Promise<BaselineRecord[]> {
  let db: IDBDatabase | undefined
  let records: BaselineRecord[] = []
  try {
    db = await openArchive()
    records = await new Promise((resolve, reject) => {
      const request = db!.transaction('baselines', 'readonly').objectStore('baselines').getAll()
      request.onsuccess = () => resolve(request.result as BaselineRecord[])
      request.onerror = () => reject(request.error)
    })
  } catch {
    failure = '기준 자료 저장소를 읽지 못했습니다. 이 화면에서 수집한 자료는 내려받을 수 있습니다.'
  } finally { db?.close() }
  const merged = new Map(records.map(record => [record.calibration_id, record]))
  for (const [id, record] of pending) merged.set(id, record)
  return [...merged.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
}
