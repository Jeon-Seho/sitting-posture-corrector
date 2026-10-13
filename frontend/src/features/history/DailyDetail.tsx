import { useId, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { RateRing } from '../../components/RateRing'
import { periodStats } from '../../lib/comparison'
import { localDay } from '../../lib/history'
import type { RecordItem } from '../../lib/serviceStore'
import { daySessionNumber } from '../../lib/sessionNumber'
import { formatDuration } from '../../lib/stats'
import { RecordHistoryItem } from './RecordHistoryItem'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
export type DayGroup = { day: string; records: RecordItem[] }

/** Days of `records` (by session start), newest first; sessions inside a day oldest first. */
export function groupByDay(records: RecordItem[]): DayGroup[] {
  const groups = new Map<string, RecordItem[]>()
  for (const record of records) {
    const day = localDay(record.startedAt)
    groups.set(day, [...(groups.get(day) ?? []), record])
  }
  return [...groups]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, items]) => ({ day, records: items.sort((a, b) => a.startedAt.localeCompare(b.startedAt)) }))
}

function dayTitle(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return `${m}/${d} (${WEEKDAY[new Date(y, m - 1, d).getDay()]})`
}

/**
 * 일별 상세: each day is one ring (keep rate) at a glance. Opening a day shows its totals and
 * its sessions, numbered per day (2026-10-13: fewer words in the folded view).
 */
export function DailyDetail({ records, allStarts }: { records: RecordItem[]; allStarts: string[] }) {
  const days = groupByDay(records)
  if (days.length === 0) return <p className="fine">선택한 기간에 기록이 없어요. 첫 측정을 마치면 여기에 쌓여요.</p>
  return (
    <ul className="day-list">
      {days.map((group) => (
        <DayRow key={group.day} group={group} allStarts={allStarts} />
      ))}
    </ul>
  )
}

function DayRow({ group, allStarts }: { group: DayGroup; allStarts: string[] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const s = periodStats(group.records, group.day, group.day)
  const excluded = group.records.reduce((n, r) => n + Math.max(0, r.total - r.valid), 0)
  return (
    <li className={`day-row ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="day-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <RateRing rate={s.keepRate} />
        <span className="day-text">
          <strong>{dayTitle(group.day)}</strong>
          <span>
            세션 {s.sessions} · {formatDuration(s.valid)}
          </span>
        </span>
        <span className="day-alerts" title="받은 알림">
          알림 <b className="num">{s.alerts}</b>
        </span>
        <CaretDown size={18} weight="bold" className="day-caret" aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className="day-body">
          <dl className="day-facts">
            <Fact label="유효 측정" value={formatDuration(s.valid)} />
            <Fact label="판정 불가" value={formatDuration(excluded)} />
            <Fact label="이탈 사건" value={`${s.events}건`} />
            <Fact label="알림" value={`${s.alerts}회`} />
            <Fact label="평균 간격" value={formatDuration(s.meanInterval)} />
            <Fact label="평균 회복" value={formatDuration(s.meanRecovery)} />
          </dl>
          <div className="day-sessions">
            {[...group.records].reverse().map((record) => (
              <RecordHistoryItem
                key={record.id}
                record={record}
                sessionNumber={daySessionNumber(allStarts, record.startedAt)}
              />
            ))}
          </div>
        </div>
      )}
    </li>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  )
}
