import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordItem } from '../../lib/serviceStore'
import { LocalHistory } from './LocalHistory'

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString()
const rec = (id: string, day: number, hour: number, valid: number, good: number): RecordItem => ({
  id,
  startedAt: at(day, hour),
  endedAt: new Date(Date.parse(at(day, hour)) + valid * 1000).toISOString(),
  mode: 'camera',
  total: valid,
  valid,
  good,
  events: [],
})

describe('records screen: heatmap, today, periods and calendar (synthetic records)', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 13, 20))
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    vi.useRealTimers()
  })
  const records = [rec('old', 2, 10, 4000, 3000), rec('y', 12, 9, 900, 600), rec('t1', 13, 9, 1200, 900), rec('t2', 13, 15, 600, 300)]
  const mount = () =>
    act(() => {
      renderer = create(<LocalHistory records={records} measuring={false} onStart={() => {}} />)
    })
  const text = () => JSON.stringify(renderer!.toJSON())
  const cell = (label: string) =>
    renderer!.root.findAll((n) => n.type === 'button' && String(n.props['aria-label']).startsWith(label))[0]

  it('shows only today by default, with today’s sessions open', () => {
    mount()
    expect(text()).toContain('오늘의 기록')
    expect(text()).toContain('세션 2 ·')
    expect(text()).toContain('세션 1 ·')
    // Yesterday's session is not listed until that day is picked.
    expect(renderer!.root.findAll((n) => n.props.className === 'history-record')).toHaveLength(2)
  })

  it('grades heatmap days by measured time and picks a day from it', () => {
    mount()
    expect(cell('10월 2일').props.className).toContain('level-4') // 4000 s
    expect(cell('10월 12일').props.className).toContain('level-2') // 900 s
    expect(cell('10월 5일').props.className).toContain('level-0')
    act(() => cell('10월 12일').props.onClick())
    expect(text()).toContain('10월 12일 (월) 기록')
    expect(renderer!.root.findAll((n) => n.props.className === 'history-record')).toHaveLength(1)
    act(() => renderer!.root.findAll((n) => n.type === 'button' && n.children.join('') === '오늘로')[0].props.onClick())
    expect(text()).toContain('오늘의 기록')
  })

  it('opens the month calendar and selects a day from it', () => {
    mount()
    const tab = (label: string) => renderer!.root.findAll((n) => n.type === 'button' && n.children.join('') === label)[0]
    act(() => tab('달력').props.onClick())
    expect(text()).toContain('2026년 10월')
    const day2 = renderer!.root.findAll((n) => n.props.role === 'gridcell' && String(n.props['aria-label']).startsWith('2일'))[0]
    act(() => day2.props.onClick())
    expect(text()).toContain('10월 2일 (금) 기록')
    act(() => tab('최근 30일').props.onClick())
    expect(text()).toContain('3일 측정') // 10/2, 10/12, 10/13
  })
})
