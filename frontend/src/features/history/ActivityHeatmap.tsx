import { useState } from 'react'
import { formatDuration } from '../../lib/stats'
import { activityLevel, addDays, dateOf, type DailyStat } from './recordsSource'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
/** 13 weeks = 91 days, one `/stats/daily` request (≤ 92 days). */
export const HEATMAP_WEEKS = 13

export function dayLabel(day: string) {
  const d = dateOf(day)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY[d.getDay()]})`
}

/**
 * 측정한 날 한눈에 (2026-10-13): like a contribution graph, darker = longer measured that
 * day. Columns are weeks (Sunday on top), the last column is this week. A day is a button.
 */
export function ActivityHeatmap({
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
  const [hover, setHover] = useState<string | null>(null)
  const byDay = new Map(stats.map((s) => [s.date, s]))
  // Start on the Sunday 12 weeks before this week's Sunday.
  const start = addDays(today, -dateOf(today).getDay() - (HEATMAP_WEEKS - 1) * 7)
  const weeks = Array.from({ length: HEATMAP_WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)),
  )
  const shown = hover ?? selected
  const info = byDay.get(shown)
  const measuredDays = stats.filter((s) => s.valid_sec > 0).length

  return (
    <div className="heatmap">
      <div className="heatmap-body">
        <div className="heatmap-weekdays" aria-hidden="true">
          {WEEKDAY.map((w, i) => (
            <span key={w}>{i % 2 ? w : ''}</span>
          ))}
        </div>
        <div className="heatmap-grid" role="grid" aria-label={`최근 ${HEATMAP_WEEKS}주 측정한 날`}>
          {weeks.map((week, w) => {
            const first = dateOf(week[0])
            const showMonth = w === 0 || first.getDate() <= 7
            return (
              <div className="heatmap-week" role="row" key={week[0]}>
                <span className="heatmap-month" aria-hidden="true">
                  {showMonth ? `${first.getMonth() + 1}월` : ''}
                </span>
                {week.map((day) => {
                  const s = byDay.get(day)
                  const future = day > today
                  const level = s ? activityLevel(s.valid_sec) : 0
                  return (
                    <button
                      key={day}
                      type="button"
                      role="gridcell"
                      className={`heatmap-cell level-${level} ${day === selected ? 'is-selected' : ''} ${day === today ? 'is-today' : ''}`}
                      disabled={future}
                      aria-label={`${dayLabel(day)} ${s ? `${formatDuration(s.valid_sec)} 측정` : '측정 없음'}`}
                      aria-pressed={day === selected}
                      onClick={() => onSelect(day)}
                      onPointerEnter={() => setHover(day)}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover(day)}
                      onBlur={() => setHover(null)}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <div className="heatmap-foot">
        <p className="heatmap-info" role="status">
          <b>{dayLabel(shown)}</b>
          {info
            ? ` · ${formatDuration(info.valid_sec)} 측정 · 바른 자세 ${info.good_ratio === null ? '—' : `${Math.round(info.good_ratio * 100)}%`} · 세션 ${info.session_count}개`
            : ' · 측정 없음'}
        </p>
        <div className="heatmap-legend" aria-hidden="true">
          <span>적게</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <i key={l} className={`heatmap-cell level-${l}`} />
          ))}
          <span>많이</span>
        </div>
      </div>
      <p className="fine">최근 {HEATMAP_WEEKS}주 중 {measuredDays}일 측정했어요.</p>
    </div>
  )
}
