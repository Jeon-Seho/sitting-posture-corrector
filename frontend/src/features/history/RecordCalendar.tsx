import { useState } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Card, ComboChart, Legend } from '../../components/ui'
import { Segmented } from '../../components/Segmented'
import { formatDuration } from '../../lib/stats'
import { activityLevel, addDays, dateOf, dayKey, type DailyStat } from './recordsSource'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
type View = 'week' | 'month' | 'calendar'

/**
 * 최근 7일 · 최근 30일 · 달력 (2026-10-13). Long histories no longer stack up the page:
 * the periods are charts and the calendar picks a day for the record panel above.
 */
export function RecordCalendar({
  stats,
  today,
  selected,
  onSelect,
}: {
  stats: DailyStat[]
  today: string
  selected: string
  onSelect: (day: string) => void
}) {
  const [view, setView] = useState<View>('week')
  return (
    <Card
      title="기간별 기록"
      action={
        <Segmented label="기간 보기">
          {(
            [
              ['week', '최근 7일'],
              ['month', '최근 30일'],
              ['calendar', '달력'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </Segmented>
      }
    >
      {view === 'calendar' ? (
        <MonthCalendar stats={stats} today={today} selected={selected} onSelect={onSelect} />
      ) : (
        <PeriodChart stats={stats} today={today} days={view === 'week' ? 7 : 30} />
      )}
    </Card>
  )
}

function PeriodChart({ stats, today, days }: { stats: DailyStat[]; today: string; days: number }) {
  const byDay = new Map(stats.map((s) => [s.date, s]))
  const list = Array.from({ length: days }, (_, i) => addDays(today, i - (days - 1)))
  const rows = list.map((day) => byDay.get(day))
  const total = rows.reduce((n, s) => n + (s?.valid_sec ?? 0), 0)
  const good = rows.reduce((n, s) => n + (s?.good_sec ?? 0), 0)
  const measured = rows.filter(Boolean).length
  return (
    <>
      <p className="calendar-summary">
        {`${measured}일 측정 · 모두 ${formatDuration(total)} · 바른 자세 ${total ? `${Math.round((good / total) * 100)}%` : '—'}`}
      </p>
      <ComboChart
        bars={list.map((day, i) => {
          const d = dateOf(day)
          return {
            label: days <= 7 ? `${d.getMonth() + 1}/${d.getDate()}` : String(d.getDate()),
            sub: days <= 7 ? WEEKDAY[d.getDay()] : undefined,
            value: rows[i]?.good_ratio ?? null,
          }
        })}
        line={rows.map((s) => (s && s.valid_sec > 0 ? s.valid_sec / 3600 : null))}
        barUnit="%"
        lineUnit="시간"
        barMax={1}
        barName="바른 자세 유지율"
        lineName="측정 시간"
        formatBar={(rate) => `${(rate * 100).toFixed(1)}%`}
        formatLine={(hours) => formatDuration(hours * 3600)}
        details={(i) => [
          { label: '세션', value: `${rows[i]?.session_count ?? 0}회` },
          { label: '자세 경고', value: `${rows[i]?.event_count ?? 0}번` },
        ]}
      />
      <Legend
        items={[
          { color: 'var(--primary-soft)', label: '바른 자세 유지율' },
          { color: 'var(--primary)', label: '측정 시간' },
        ]}
      />
    </>
  )
}

function MonthCalendar({
  stats,
  today,
  selected,
  onSelect,
}: {
  stats: DailyStat[]
  today: string
  selected: string
  onSelect: (day: string) => void
}) {
  const base = dateOf(selected)
  const [month, setMonth] = useState({ y: base.getFullYear(), m: base.getMonth() })
  const byDay = new Map(stats.map((s) => [s.date, s]))
  const first = new Date(month.y, month.m, 1, 12)
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate()
  const cells: (string | null)[] = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => dayKey(new Date(month.y, month.m, i + 1, 12))),
  ]
  const thisMonth = dateOf(today)
  const atLatest = month.y === thisMonth.getFullYear() && month.m === thisMonth.getMonth()
  const monthStats = cells.flatMap((d) => (d && byDay.get(d) ? [byDay.get(d)!] : []))
  const total = monthStats.reduce((n, s) => n + s.valid_sec, 0)
  const good = monthStats.reduce((n, s) => n + s.good_sec, 0)
  const shift = (n: number) =>
    setMonth(({ y, m }) => {
      const d = new Date(y, m + n, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  return (
    <div className="calendar">
      <div className="calendar-head">
        <button className="btn btn-icon btn-sm" aria-label="이전 달" onClick={() => shift(-1)}>
          <CaretLeft size={16} weight="bold" />
        </button>
        <strong>
          {month.y}년 {month.m + 1}월
        </strong>
        <button className="btn btn-icon btn-sm" aria-label="다음 달" disabled={atLatest} onClick={() => shift(1)}>
          <CaretRight size={16} weight="bold" />
        </button>
        <span className="calendar-summary">
          {`${monthStats.length}일 측정 · 모두 ${formatDuration(total)} · 바른 자세 ${total ? `${Math.round((good / total) * 100)}%` : '—'}`}
        </span>
      </div>
      <div className="calendar-grid" role="grid" aria-label={`${month.y}년 ${month.m + 1}월`}>
        {WEEKDAY.map((w) => (
          <span key={w} className="calendar-weekday" role="columnheader">
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (!day) return <span key={`blank-${i}`} className="calendar-blank" />
          const s = byDay.get(day)
          const future = day > today
          return (
            <button
              key={day}
              type="button"
              role="gridcell"
              className={`calendar-day level-${s ? activityLevel(s.valid_sec) : 0} ${day === selected ? 'is-selected' : ''} ${day === today ? 'is-today' : ''}`}
              disabled={future}
              aria-pressed={day === selected}
              aria-label={`${dateOf(day).getDate()}일 ${s ? `${formatDuration(s.valid_sec)} 측정` : '측정 없음'}`}
              onClick={() => onSelect(day)}
            >
              <span className="calendar-date">{dateOf(day).getDate()}</span>
              {s && (
                <>
                  <span className="calendar-rate">{s.good_ratio === null ? '—' : `${Math.round(s.good_ratio * 100)}%`}</span>
                  <span className="calendar-time">{formatDuration(s.valid_sec)}</span>
                </>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
