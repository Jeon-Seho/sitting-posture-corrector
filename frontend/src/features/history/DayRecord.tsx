import { Bell, Clock, Play } from '@phosphor-icons/react'
import { Card } from '../../components/ui'
import { Amount } from '../../components/Amount'
import { MetricGroups, metricGroupsFor } from '../../components/MetricGroups'
import { GOOD_RATE } from '../../components/RateRing'
import { Ring } from '../../components/Ring'
import type { RecordItem } from '../../lib/serviceStore'
import { daySessionNumber } from '../../lib/sessionNumber'
import { formatDuration, formatRate } from '../../lib/stats'
import { dayLabel } from './ActivityHeatmap'
import { RecordHistoryItem } from './RecordHistoryItem'
import { dailyStats, sessionsOn } from './recordsSource'

/**
 * One day's record (2026-10-14 layout): a large keep-rate ring with the day's verdict, the
 * measured time and alerts beside it, a 24-hour strip showing when each session ran, then
 * the grouped metrics and every session. Data has the `GET /records?date=` shape
 * (api-ws-spec 2.6).
 */
export function DayRecord({
  records,
  day,
  today,
  measuring,
  onStart,
  onClose,
}: {
  records: RecordItem[]
  day: string
  today: string
  measuring: boolean
  onStart: () => void
  /** Shows a 닫기 chip (달력 tab). */
  onClose?: () => void
}) {
  const sessions = sessionsOn(records, day)
  const [s] = dailyStats(records, day, day)
  const isToday = day === today
  const allStarts = records.map((r) => r.startedAt)
  const rate = s?.good_ratio ?? null
  const good = rate !== null && rate >= GOOD_RATE
  return (
    <Card
      title={isToday ? '오늘의 기록' : `${dayLabel(day)} 기록`}
      note={isToday ? dayLabel(day) : undefined}
      action={
        onClose ? (
          <button className="chip" onClick={onClose}>
            닫기
          </button>
        ) : undefined
      }
    >
      {!s ? (
        <div className="day-record-empty">
          <p className="fine">{isToday ? '오늘은 아직 측정하지 않았어요.' : '이날은 측정한 기록이 없어요.'}</p>
          {isToday && (
            <button className="btn btn-primary btn-sm" onClick={onStart}>
              <Play size={15} weight="fill" className="icon" />
              {measuring ? '진행 중인 측정으로' : '측정 시작'}
            </button>
          )}
        </div>
      ) : (
        <div className="day-record">
          <div className="day-hero">
            <div className="day-hero-rate" data-stat="rate">
              <Ring
                value={rate}
                size={112}
                stroke={12}
                color={good ? 'var(--good)' : 'var(--alert-soft)'}
                label={rate === null ? '측정한 시간 없음' : `바른 자세 ${Math.round(rate * 100)}%`}
              />
              <div>
                <div className="day-hero-label">바른 자세 유지율</div>
                <div className="day-hero-value records-stat-value">
                  <Amount value={rate === null ? '—' : `${Math.round(rate * 100)}%`} />
                </div>
                {rate !== null && (
                  <span className={`day-hero-verdict ${good ? 'is-good' : ''}`}>
                    {good ? '목표 75% 달성' : `목표 75%까지 ${Math.round((GOOD_RATE - rate) * 100)}%p`}
                  </span>
                )}
              </div>
            </div>
            <div className="day-hero-facts">
              <div className="day-fact" data-stat="valid">
                <Clock size={20} weight="bold" className="icon" />
                <div>
                  <div className="day-fact-label">측정 시간</div>
                  <div className="day-fact-value records-stat-value">
                    <Amount value={formatDuration(s.valid_sec)} />
                  </div>
                  <div className="day-fact-sub">
                    세션 <span data-stat="count">{s.session_count}</span>회
                  </div>
                </div>
              </div>
              <div className="day-fact" data-stat="alerts">
                <Bell size={20} weight="bold" className="icon" />
                <div>
                  <div className="day-fact-label">알림</div>
                  <div className="day-fact-value records-stat-value">
                    <Amount value={`${s.alert_count}회`} />
                  </div>
                  <div className="day-fact-sub">
                    {`자세 경고 ${s.event_count}번` +
                      (s.valid_sec >= 1800 ? ` · 한 시간에 ${formatRate(s.alert_count / (s.valid_sec / 3600), '회')}` : '')}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DayTimeline sessions={sessions} day={day} />
          <MetricGroups
            groups={metricGroupsFor({
              measured: s.valid_sec,
              good: s.good_sec,
              deviation: s.valid_sec - s.good_sec,
              unknown: s.excluded_sec,
              warnings: s.event_count,
              alerts: s.alert_count,
              interval: s.interval_mean_sec,
              recovery: s.recovery_mean_sec,
            })}
          />
          <div className="day-sessions">
            {sessions.map((record) => (
              <RecordHistoryItem
                key={record.id}
                record={record}
                sessionNumber={daySessionNumber(allStarts, record.startedAt)}
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

/** When the day's sessions ran, on a 0–24 h strip; each block is tinted by its keep rate. */
function DayTimeline({ sessions, day }: { sessions: RecordItem[]; day: string }) {
  const [y, m, d] = day.split('-').map(Number)
  const start = new Date(y, m - 1, d).getTime()
  const span = 24 * 3600 * 1000
  const at = (iso: string) => Math.max(0, Math.min(1, (Date.parse(iso) - start) / span)) * 100
  return (
    <div className="day-timeline" role="img" aria-label={`하루 중 측정한 시간대 ${sessions.length}개`}>
      <div className="day-timeline-track">
        {sessions.map((r) => {
          const rate = r.valid ? r.good / r.valid : null
          const left = at(r.startedAt)
          const time = new Date(r.startedAt).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
          return (
            <span
              key={r.id}
              className={`day-timeline-block ${rate !== null && rate >= GOOD_RATE ? 'is-good' : ''}`}
              style={{ left: `${left}%`, width: `${Math.max(at(r.endedAt) - left, 0.6)}%` }}
              title={`${time} · ${formatDuration(r.valid)} 측정${rate === null ? '' : ` · 바른 자세 ${Math.round(rate * 100)}%`}`}
            />
          )
        })}
      </div>
      <div className="day-timeline-ticks" aria-hidden="true">
        {['0시', '6시', '12시', '18시', '24시'].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  )
}
