import { formatDuration } from '../../lib/stats'
import { activityLevel, addDays, dateOf, type DailyStat } from './recordsSource'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
/** 53 weeks: a full year like Daylio's Year in Pixels (four or five `/stats/daily` requests of ≤ 92 days). */
export const HEATMAP_WEEKS = 53

export function dayLabel(day: string) {
  const d = dateOf(day)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY[d.getDay()]})`
}

/**
 * 측정한 날 (2026-10-14): a year of days, darker = longer measured that day. Columns are
 * weeks (Sunday on top) and stretch to fill the card; the last column is this week.
 * Display only: days are picked in the month calendar.
 */
export function ActivityHeatmap({ stats, today }: { stats: DailyStat[]; today: string }) {
  const byDay = new Map(stats.map((s) => [s.date, s]))
  // Start on the Sunday 52 weeks before this week's Sunday.
  const start = addDays(today, -dateOf(today).getDay() - (HEATMAP_WEEKS - 1) * 7)
  const weeks = Array.from({ length: HEATMAP_WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)),
  )

  return (
    <div className="heatmap">
      <div className="heatmap-body">
        <div className="heatmap-weekdays" aria-hidden="true">
          <span />
          {WEEKDAY.map((w, i) => (
            <span key={w}>{i % 2 ? w : ''}</span>
          ))}
        </div>
        <div className="heatmap-grid" role="img" aria-label="최근 1년 측정한 날">
          {weeks.map((week, w) => {
            const first = dateOf(week[0])
            const showMonth = w > 0 && first.getDate() <= 7
            return (
              <div className="heatmap-week" key={week[0]}>
                <span className="heatmap-month">{showMonth ? `${first.getMonth() + 1}월` : ''}</span>
                {week.map((day) => {
                  const s = byDay.get(day)
                  const future = day > today
                  return (
                    <i
                      key={day}
                      className={`heatmap-cell level-${s ? activityLevel(s.valid_sec) : 0} ${future ? 'is-future' : ''} ${day === today ? 'is-today' : ''}`}
                      data-tip={future ? undefined : `${dayLabel(day)} · ${s ? `${formatDuration(s.valid_sec)} 측정` : '측정 없음'}`}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 적게 ▢▢▢▢▢ 많이 */
export function HeatmapLegend() {
  return (
    <div className="heatmap-legend" aria-hidden="true">
      <span>적게</span>
      {[0, 1, 2, 3, 4].map((l) => (
        <i key={l} className={`heatmap-cell level-${l}`} />
      ))}
      <span>많이</span>
    </div>
  )
}
