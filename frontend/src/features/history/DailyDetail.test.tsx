import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import type { RecordItem } from '../../lib/serviceStore'
import { DailyDetail, groupByDay } from './DailyDetail'

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString()
const record = (id: string, day: number, hour: number, valid: number, good: number): RecordItem => ({
  id,
  startedAt: at(day, hour),
  endedAt: new Date(Date.parse(at(day, hour)) + (valid + 60) * 1000).toISOString(),
  mode: 'camera',
  total: valid + 60,
  valid,
  good,
  events: [],
})

describe('일별 상세', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => act(() => renderer?.unmount()))

  const records = [
    record('a', 12, 9, 600, 300),
    record('b', 13, 14, 1200, 1000),
    record('c', 13, 9, 600, 500),
  ]

  it('groups by the local start day, newest day first and sessions oldest first', () => {
    expect(groupByDay(records).map((g) => [g.day, g.records.map((r) => r.id)])).toEqual([
      ['2026-10-13', ['c', 'b']],
      ['2026-10-12', ['a']],
    ])
  })

  it('folds each day to a keep-rate ring and opens it to the numbered sessions', () => {
    act(() => {
      renderer = create(<DailyDetail records={records} allStarts={records.map((r) => r.startedAt)} />)
    })
    const heads = renderer!.root.findAll((n) => n.props.className === 'day-head')
    expect(heads).toHaveLength(2)
    // 10/13: (1000 + 500) / (1200 + 600) = 83%
    expect(renderer!.root.findAll((n) => n.props.label === '바른 자세 83%').length).toBeGreaterThan(0)
    expect(heads[0].props['aria-expanded']).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('세션 2 ·')
    act(() => heads[0].props.onClick())
    const text = JSON.stringify(renderer!.toJSON())
    expect(text).toContain('세션 2 ·')
    expect(text).toContain('세션 1 ·')
    expect(text).toContain('확인 못 한 시간')
  })
})
