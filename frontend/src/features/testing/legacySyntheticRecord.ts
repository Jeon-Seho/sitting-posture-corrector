import type { RecordItem } from '../storage/types'
import { requireSyntheticMode } from './guard'
requireSyntheticMode()
/** Explicit synthetic old-format browser record; unknown fields stay absent. */

export function legacySyntheticRecord(): RecordItem {
  const at = new Date(Date.now() - 14 * 86_400_000).toISOString()
  return {
    id: '33333333-3333-4333-8333-333333333333',
    startedAt: at,
    endedAt: at,
    mode: 'camera',
    valid: 0,
    good: 0,
    total: 0,
    events: [],
  }
}
