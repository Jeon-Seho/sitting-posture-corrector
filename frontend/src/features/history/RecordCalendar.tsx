import { useEffect, useState, type CSSProperties } from 'react'
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

/**
 * Month calendar (2026-10-13, Toss-style): plain cells; a ring around the date fills with
 * that day's keep rate and the measured time sits underneath. Pressing a day opens that
 * day's record below.
 * The week containing today sits on a horizontal band.
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
        <span />
        <div className="calendar-month">
          <button className="btn btn-icon btn-sm btn-quiet" aria-label="이전 달" onClick={() => shift(-1)}>
            <CaretLeft size={18} weight="bold" />
          </button>
          <strong>
            {month.y}년 {month.m + 1}월
          </strong>
          <button
            className="btn btn-icon btn-sm btn-quiet"
            aria-label="다음 달"
            disabled={atLatest}
            onClick={() => shift(1)}
          >
            <CaretRight size={18} weight="bold" />
          </button>
        </div>
        {!atLatest && (
          <button className="chip" onClick={toToday}>
            이번 달
          </button>
        )}
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
                    {/* The ring around the date fills with that day's keep rate (2026-10-14). */}
                    <span
                      className={`calendar-date ${rate !== null ? 'has-ring' : ''} ${rate !== null && rate >= GOOD_RATE ? 'is-good' : ''}`}
                      style={rate !== null ? ({ '--rate': rate } as CSSProperties) : undefined}
                    >
                      {dateOf(day).getDate()}
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

function PeriodChart({ stats, today, days }: { stats: DailyStat[]; today: string; days: number }) {
  const byDay = new Map(stats.map((s) => [s.date, s]))
  const list = Array.from({ length: days }, (_, i) => addDays(today, i - (days - 1)))
  const rows = list.map((day) => byDay.get(day))
  return (
    <>
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
