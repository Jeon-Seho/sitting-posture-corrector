import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { RecordHistoryItem } from './RecordHistoryItem'
import { kstDay, kstDayStart } from '../../lib/kstDay'

describe('KST display at the UTC date boundary', () => {
  it('moves the day at Korean midnight rather than UTC midnight', () => {
    expect(kstDay('2026-10-26T14:59:59.999Z')).toBe('2026-10-26')
    expect(kstDay('2026-10-26T15:00:00.000Z')).toBe('2026-10-27')
    expect(kstDayStart('2026-10-27')).toBe(Date.parse('2026-10-26T15:00:00.000Z'))
  })

  it('uses the same Korean date, weekday and clock in a record title', () => {
    let view: ReturnType<typeof create>
    act(() => { view = create(<RecordHistoryItem record={{
      id: 'synthetic-timezone', mode: 'camera', startedAt: '2026-10-26T15:30:00.000Z',
      endedAt: '2026-10-26T15:31:00.000Z', total: 60, valid: 60, good: 60, events: [],
    }} />) })
    expect(view!.root.findByType('strong').children.join('')).toBe('10/27 (화) 오전 12:30')
    act(() => view!.unmount())
  })
})
