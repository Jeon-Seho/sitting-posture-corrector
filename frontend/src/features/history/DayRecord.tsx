import { Play } from '@phosphor-icons/react'
import { Card } from '../../components/ui'
import { Amount } from '../../components/Amount'
import { MetricGroups, metricGroupsFor } from '../../components/MetricGroups'
import { GOOD_RATE } from '../../components/RateRing'
import { Ring } from '../../components/Ring'
import { tip } from '../../components/TipLayer'
import type { RecordItem } from '../../lib/serviceStore'
import { kstDayStart, kstTime } from '../../lib/kst'
import { daySessionNumber } from '../../lib/sessionNumber'
import { formatDuration } from '../../lib/stats'
import { dayLabel } from './ActivityHeatmap'
import { RecordHistoryItem } from './RecordHistoryItem'
import { dailyStats, sessionsOn } from './recordsSource'

/**
 * Today's record in the 기록 tab (2026-10-14, Oura-style). One number leads: a large
 * keep-rate ring. Under it one line (time · alerts · sessions), when the sessions ran,
 * and the sessions. Week comparisons live in the 달력 tab. The detailed numbers are
 * folded under 자세히. Data has the `GET /records?date=` shape (api-ws-spec 2.6).
 */
export function DayRecord({
  records,
  day,
  today,
  measuring,
  onStart,
}: {
  records: RecordItem[]
  day: string
  today: string
  measuring: boolean
  onStart: () => void
}) {
  const sessions = sessionsOn(records, day)
  const [s] = dailyStats(records, day, day)
  const isToday = day === today
  const allStarts = records.map((r) => r.startedAt)
  const rate = s?.good_ratio ?? null
  // Colour by the shown percent: 74.9% reads as 75% and should look the same as 75%.
  const percent = rate === null ? null : Math.round(rate * 100)
  const good = percent !== null && percent >= GOOD_RATE * 100
  return (
    <Card title={isToday ? '오늘의 기록' : `${dayLabel(day)} 기록`} note={isToday ? dayLabel(day) : undefined}>
      <div className="day-record">
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
          <div className="today-hero">
            <div data-stat="rate">
              <Ring
                value={rate}
                size={188}
                stroke={20}
                color={good ? 'var(--good)' : 'var(--alert-soft)'}
                label={percent === null ? '측정한 시간 없음' : `바른 자세 ${percent}%`}
              >
                <span className="today-hero-value records-stat-value">
                  <Amount value={percent === null ? '—' : `${percent}%`} />
                </span>
                <span className="today-hero-caption">바른 자세</span>
              </Ring>
            </div>
            <p className="today-line">
              <span data-stat="valid">
                <b className="records-stat-value">{formatDuration(s.valid_sec)}</b> 측정
              </span>
              <span data-stat="alerts">
                알림 <b className="records-stat-value">{`${s.alert_count}회`}</b>
              </span>
              <span>
                세션 <span data-stat="count">{s.session_count}</span>회
              </span>
            </p>
          </div>
        )}
        {s && (
          <>
            <DayTimeline sessions={sessions} day={day} />
            <div className="day-sessions">
              {sessions.map((record) => (
                <RecordHistoryItem
                  key={record.id}
                  record={record}
                  sessionNumber={daySessionNumber(allStarts, record.startedAt)}
                />
              ))}
            </div>
            <details className="more">
              <summary>자세히</summary>
              <div className="more-body">
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
              </div>
            </details>
          </>
        )}
      </div>
    </Card>
  )
}

/** When the day's sessions ran, on a 0–24 h strip; each block is tinted by its keep rate. */
export function DayTimeline({ sessions, day }: { sessions: RecordItem[]; day: string }) {
  // The strip is the KST day 00:00–24:00 (ADR 0029).
  const start = kstDayStart(day)
  const span = 24 * 3600 * 1000
  const at = (iso: string) => Math.max(0, Math.min(1, (Date.parse(iso) - start) / span)) * 100
  return (
    <div className="day-timeline" role="img" aria-label={`하루 중 측정한 시간대 ${sessions.length}개`}>
      <div className="day-timeline-track">
        {sessions.map((r) => {
          const rate = r.valid ? r.good / r.valid : null
          const left = at(r.startedAt)
          const time = kstTime(r.startedAt)
          return (
            <span
              key={r.id}
              className={`day-timeline-block ${rate !== null && Math.round(rate * 100) >= GOOD_RATE * 100 ? 'is-good' : ''}`}
              style={{ left: `${left}%`, width: `${Math.max(at(r.endedAt) - left, 0.6)}%` }}
              {...tip(time, [
                ['측정 시간', formatDuration(r.valid)],
                [
                  '바른 자세',
                  rate === null ? '—' : `${Math.round(rate * 100)}%`,
                  rate !== null && Math.round(rate * 100) >= GOOD_RATE * 100 ? 'var(--good)' : 'var(--alert-soft)',
                ],
                ['자세 경고', `${r.events.length}번`],
              ])}
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
