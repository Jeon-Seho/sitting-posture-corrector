import { useEffect, useState } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Card, ComboChart, Legend } from '../../components/ui'
import { Segmented } from '../../components/Segmented'
import { GOOD_RATE } from '../../components/RateRing'
import { formatDuration } from '../../lib/stats'
import { addDays, dateOf, dayKey, type DailyStat } from './recordsSource'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/** "45분", "1시간 20분": short enough for a calendar cell. */
export function shortDuration(sec: number) {
  const m = Math.max(1, Math.round(sec / 60))
  if (m < 60) return `${m}분`
  return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m / 60}시간`
}

const RING_R = 17
const RING_C = 2 * Math.PI * RING_R

/** Keep-rate ring drawn as SVG strokes (smooth at any zoom), like Apple Fitness history. */
export function DayRing({ rate }: { rate: number }) {
  return (
    <svg
      className={`calendar-ring ${Math.round(rate * 100) >= GOOD_RATE * 100 ? 'is-good' : ''}`}
      viewBox="0 0 40 40"
      aria-hidden="true"
    >
      <circle className="calendar-ring-track" cx="20" cy="20" r={RING_R} />
      {rate > 0 && (
        <circle
          className="calendar-ring-value"
          cx="20"
          cy="20"
          r={RING_R}
          strokeDasharray={`${Math.max(rate * RING_C, 0.5)} ${RING_C}`}
          transform="rotate(-90 20 20)"
        />
      )}
    </svg>
  )
}

/**
 * Month calendar (2026-10-14). Apple Fitness-style: a ring around each measured date fills
 * with that day's keep rate, measured time underneath. Like Day One, pressing a date opens
 * that day beside the calendar. The week containing today sits on a horizontal band.
 */
export function MonthCalendar({
  stats,
  today,
  selected,
  onSelect,
}: {
  stats: DailyStat[]
  today: string
  selected: string | null
  onSelect: (day: string) => void
}) {
  const base = dateOf(selected ?? today)
  const [month, setMonth] = useState({ y: base.getFullYear(), m: base.getMonth() })
  // A day picked elsewhere (the 잔디) brings its month into view.
  useEffect(() => {
    if (!selected) return
    const d = dateOf(selected)
    setMonth({ y: d.getFullYear(), m: d.getMonth() })
  }, [selected])
  const byDay = new Map(stats.map((s) => [s.date, s]))
  const first = new Date(month.y, month.m, 1, 12)
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate()
  const firstKey = dayKey(first)
  const weekCount = Math.ceil((first.getDay() + daysInMonth) / 7)
  const thisWeek = addDays(today, -dateOf(today).getDay())
  const weeks = Array.from({ length: weekCount }, (_, w) => {
    const sunday = addDays(firstKey, w * 7 - first.getDay())
    return {
      sunday,
      days: Array.from({ length: 7 }, (_, d) => {
        const day = addDays(sunday, d)
        return dateOf(day).getMonth() === month.m ? day : null
      }),
    }
  })
  const thisMonth = dateOf(today)
  const atLatest = month.y === thisMonth.getFullYear() && month.m === thisMonth.getMonth()
  const shift = (n: number) =>
    setMonth(({ y, m }) => {
      const d = new Date(y, m + n, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  const toToday = () => setMonth({ y: thisMonth.getFullYear(), m: thisMonth.getMonth() })

  return (
    <div className="calendar">
      <div className="calendar-head">
        <h3 className="calendar-title">
          {month.m + 1}월<small>{month.y}</small>
        </h3>
        {!atLatest && (
          <button className="chip" onClick={toToday}>
            이번 달
          </button>
        )}
        <button className="btn btn-icon btn-sm btn-quiet" aria-label="이전 달" onClick={() => shift(-1)}>
          <CaretLeft size={18} weight="bold" />
        </button>
        <button
          className="btn btn-icon btn-sm btn-quiet"
          aria-label="다음 달"
          disabled={atLatest}
          onClick={() => shift(1)}
        >
          <CaretRight size={18} weight="bold" />
        </button>
      </div>
      <div className="calendar-grid" role="grid" aria-label={`${month.y}년 ${month.m + 1}월`}>
        <div className="calendar-week calendar-weekdays" role="row">
          {WEEKDAY.map((w, i) => (
            <span key={w} className={`calendar-weekday ${i === 0 ? 'is-sunday' : ''}`} role="columnheader">
              {w}
            </span>
          ))}
        </div>
        {weeks.map(({ sunday, days }) => {
          const current = sunday === thisWeek
          return (
            <div
              key={sunday}
              className={`calendar-week ${current ? 'is-this-week' : ''}`}
              role="row"
              aria-label={current ? '이번 주' : undefined}
            >
              {days.map((day, i) => {
                if (!day) return <span key={`blank-${i}`} className="calendar-blank" />
                const s = byDay.get(day)
                const rate = s?.good_ratio ?? null
                return (
                  <button
                    key={day}
                    type="button"
                    role="gridcell"
                    className={`calendar-day ${s ? 'has-record' : ''} ${i === 0 ? 'is-sunday' : ''} ${day === selected ? 'is-selected' : ''} ${day === today ? 'is-today' : ''}`}
                    disabled={day > today}
                    aria-pressed={day === selected}
                    aria-label={`${dateOf(day).getDate()}일 ${s ? `${formatDuration(s.valid_sec)} 측정${rate === null ? '' : ` · 바른 자세 ${Math.round(rate * 100)}%`}` : '측정 없음'}`}
                    onClick={() => onSelect(day)}
                  >
                    <span className="calendar-date">
                      {rate !== null && <DayRing rate={rate} />}
                      <span className="calendar-num">{dateOf(day).getDate()}</span>
                    </span>
                    {s && <span className="calendar-time">{shortDuration(s.valid_sec)}</span>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 최근 7일 · 최근 30일: keep rate bars and measured hours. */
export function PeriodCard({ stats, today }: { stats: DailyStat[]; today: string }) {
  const [days, setDays] = useState<7 | 30>(7)
  return (
    <Card
      title="최근 흐름"
      action={
        <Segmented label="기간 보기">
          {([7, 30] as const).map((n) => (
            <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>
              최근 {n}일
            </button>
          ))}
        </Segmented>
      }
    >
      <PeriodChart stats={stats} today={today} days={days} />
    </Card>
  )
}

/** One bar: a day (최근 7일) or a Sunday–Saturday week clipped to the range (최근 30일). */
type Bucket = { label: string; sub?: string; days: string[] }

function buckets(today: string, days: number): Bucket[] {
  const from = addDays(today, -(days - 1))
  if (days <= 7) {
    return Array.from({ length: days }, (_, i) => {
      const day = addDays(from, i)
      const d = dateOf(day)
      return { label: `${d.getMonth() + 1}/${d.getDate()}`, sub: WEEKDAY[d.getDay()], days: [day] }
    })
  }
  // 30 bars were too dense to read (2026-10-14): group by week, about five bars.
  const out: Bucket[] = []
  for (let sunday = addDays(from, -dateOf(from).getDay()); sunday <= today; sunday = addDays(sunday, 7)) {
    const inRange = Array.from({ length: 7 }, (_, i) => addDays(sunday, i)).filter((d) => d >= from && d <= today)
    const a = dateOf(inRange[0])
    const b = dateOf(inRange[inRange.length - 1])
    out.push({
      label: `${a.getMonth() + 1}/${a.getDate()}`,
      sub: inRange.length > 1 ? `~${b.getMonth() === a.getMonth() ? '' : `${b.getMonth() + 1}/`}${b.getDate()}` : undefined,
      days: inRange,
    })
  }
  return out
}

function PeriodChart({ stats, today, days }: { stats: DailyStat[]; today: string; days: number }) {
  const byDay = new Map(stats.map((s) => [s.date, s]))
  const rows = buckets(today, days).map((bucket) => {
    const list = bucket.days.flatMap((d) => (byDay.get(d) ? [byDay.get(d)!] : []))
    const valid = list.reduce((n, s) => n + s.valid_sec, 0)
    const good = list.reduce((n, s) => n + s.good_sec, 0)
    return {
      ...bucket,
      valid,
      rate: valid > 0 ? good / valid : null,
      measured: list.length,
      sessions: list.reduce((n, s) => n + s.session_count, 0),
      events: list.reduce((n, s) => n + s.event_count, 0),
    }
  })
  return (
    <>
      <ComboChart
        bars={rows.map((r) => ({ label: r.label, sub: r.sub, value: r.rate }))}
        line={rows.map((r) => (r.valid > 0 ? r.valid / 3600 : null))}
        barUnit="%"
        lineUnit="시간"
        barMax={1}
        barName="바른 자세 유지율"
        lineName="측정 시간"
        formatBar={(rate) => `${(rate * 100).toFixed(1)}%`}
        formatLine={(hours) => formatDuration(hours * 3600)}
        details={(i) => [
          ...(rows[i].days.length > 1 ? [{ label: '측정한 날', value: `${rows[i].measured}일` }] : []),
          { label: '세션', value: `${rows[i].sessions}회` },
          { label: '자세 경고', value: `${rows[i].events}번` },
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
