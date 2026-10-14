import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComboChart } from '../../components/ui'
import type { RecordItem } from '../../lib/serviceStore'
import { LocalHistory } from './LocalHistory'
import { shortDuration } from './RecordCalendar'
import { RecordCalendarPage } from './RecordCalendarPage'

const at = (day: number, hour: number, month = 9) => new Date(2026, month, day, hour).toISOString()
const rec = (id: string, day: number, hour: number, valid: number, good: number, month = 9): RecordItem => ({
  id,
  startedAt: at(day, hour, month),
  endedAt: new Date(Date.parse(at(day, hour, month)) + valid * 1000).toISOString(),
  mode: 'camera',
  total: valid,
  valid,
  good,
  events: [],
})

describe('기록 (today) and 달력 tabs (synthetic records)', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 13, 20)) // Tuesday
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    vi.useRealTimers()
  })
  const records = [
    rec('sep', 28, 10, 1800, 1200, 8),
    rec('old', 2, 10, 4000, 3000),
    rec('y', 12, 9, 900, 600),
    rec('t1', 13, 9, 1200, 900),
    rec('t2', 13, 15, 600, 300),
  ]
  const text = () => JSON.stringify(renderer!.toJSON())
  const rows = () => renderer!.root.findAll((n) => n.props.className === 'history-record')
  const button = (label: string) =>
    renderer!.root.findAll((n) => n.type === 'button' && n.children.filter((c) => typeof c === 'string').join('') === label)[0]
  const gridDay = (label: string) =>
    renderer!.root.findAll((n) => n.props.role === 'gridcell' && String(n.props['aria-label']).startsWith(label))[0]

  it('기록 shows only today, with a way to the calendar', () => {
    const onCalendar = vi.fn()
    act(() => {
      renderer = create(<LocalHistory records={records} measuring={false} onStart={() => {}} onCalendar={onCalendar} />)
    })
    expect(text()).toContain('오늘의 기록')
    expect(text()).toContain('세션 2 ·')
    expect(rows()).toHaveLength(2)
    expect(text()).not.toContain('측정한 날')
    act(() => button('지난 기록은 달력에서').props.onClick())
    expect(onCalendar).toHaveBeenCalledOnce()
  })

  it('달력 opens no day until one is picked, bands this week and shows time pills', () => {
    act(() => {
      renderer = create(<RecordCalendarPage records={records} measuring={false} onStart={() => {}} />)
    })
    expect(text()).toContain('2026년 10월')
    expect(text()).not.toContain('오늘의 기록')
    expect(text()).not.toContain('일 측정 · 모두')
    expect(rows()).toHaveLength(0)
    const week = renderer!.root.findAll((n) => n.props.role === 'row' && n.props['aria-label'] === '이번 주')
    expect(week).toHaveLength(1)
    // The banded week is Sunday 10/11 to Saturday 10/17.
    const days = week[0].findAll((n) => n.props.role === 'gridcell').map((n) => n.props['aria-label'].split('일')[0])
    expect(days).toEqual(['11', '12', '13', '14', '15', '16', '17'])
    expect(gridDay('14일').props.disabled).toBe(true)
    // Today has its own disc class, apart from the picked day.
    expect(gridDay('13일').props.className).toContain('is-today')
    expect(gridDay('13일').props.className).not.toContain('is-selected')
    expect(gridDay('2일').props.className).toContain('has-record')
    expect(gridDay('2일').findByProps({ className: 'calendar-time' }).children).toEqual(['1시간 7분'])
    expect(gridDay('2일').props['aria-label']).toContain('바른 자세 75%')
    expect(gridDay('2일').findAll((n) => String(n.props.className).includes('calendar-ring is-good'))).toHaveLength(1)

    act(() => gridDay('12일').props.onClick())
    expect(text()).toContain('10월 12일 (월) 기록')
    expect(rows()).toHaveLength(1)
    act(() => button('닫기').props.onClick())
    expect(rows()).toHaveLength(0)
  })

  it('keeps the 잔디 display-only and pages months with the calendar', () => {
    act(() => {
      renderer = create(<RecordCalendarPage records={records} measuring={false} onStart={() => {}} />)
    })
    const cells = renderer!.root.findAll((n) => n.type === 'i' && String(n.props.className).startsWith('heatmap-cell'))
    expect(cells.length).toBeGreaterThan(90)
    expect(cells.every((n) => !n.props.onClick)).toBe(true)
    expect(cells.find((n) => String(n.props.title).startsWith('10월 2일'))!.props.className).toContain('level-4')

    act(() => renderer!.root.findByProps({ 'aria-label': '이전 달' }).props.onClick())
    expect(text()).toContain('2026년 9월')
    expect(renderer!.root.findAll((n) => n.props['aria-label'] === '이번 주')).toHaveLength(0)
    act(() => gridDay('28일').props.onClick())
    expect(text()).toContain('9월 28일 (월) 기록')
    act(() => button('이번 달').props.onClick())
    expect(text()).toContain('2026년 10월')
  })

  it('switches the recent flow between 7 and 30 days', () => {
    act(() => {
      renderer = create(<RecordCalendarPage records={records} measuring={false} onStart={() => {}} />)
    })
    expect(renderer!.root.findByType(ComboChart).props.bars).toHaveLength(7)
    act(() => button('최근 30일').props.onClick())
    const bars = renderer!.root.findByType(ComboChart).props.bars as { label: string; value: number | null }[]
    // 30 days read as weeks: 9/14–19, 9/20–26, 9/27–10/3, 10/4–10, 10/11–13.
    expect(bars.map((b) => b.label)).toEqual(['9/14', '9/20', '9/27', '10/4', '10/11'])
    expect(bars.map((b) => (b.value === null ? null : Math.round(b.value * 100)))).toEqual([null, null, 72, null, 67])
  })

  it('shortens durations for calendar cells', () => {
    expect([20, 600, 3600, 4800].map(shortDuration)).toEqual(['1분', '10분', '1시간', '1시간 20분'])
  })
})
