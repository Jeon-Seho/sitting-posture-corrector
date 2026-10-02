import { useId, useState } from 'react'
import { Clock } from '@phosphor-icons/react'
import { RECORD_SOURCE_LABEL, recordSource } from '../../lib/comparison'
import type { RecordItem } from '../../lib/serviceStore'
import { formatDuration, formatPercent } from '../../lib/stats'
import { RecordDetails } from './RecordDetails'

export function RecordHistoryItem({ record }: { record: RecordItem }) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const titleId = `${detailsId}-title`
  const date = new Date(record.startedAt).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
  const rate = record.valid ? record.good / record.valid : null
  return (
    <div className="history-record">
      <div className="service-record">
        <span className="service-record-icon" aria-hidden="true">
          <Clock size={20} weight="bold" />
        </span>
        <div>
          <strong>{date}</strong>
          <span>
            {formatDuration(record.valid)} 측정 · 알림 {record.events.reduce((n, e) => n + e.alerts, 0)}회 ·{' '}
            {RECORD_SOURCE_LABEL[recordSource(record)]}
            {record.server && !record.server.confirmed && ' · 서버 종료 미확인'}
          </span>
        </div>
        <b className={rate !== null && rate >= 0.85 ? 'good' : ''}>{formatPercent(rate, 0)}</b>
        <button
          type="button"
          className="btn history-detail-button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${date} 기록 상세 ${expanded ? '닫기' : '보기'}`}
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded ? '닫기' : '자세히'}
        </button>
      </div>
      {expanded && <RecordDetails record={record} id={detailsId} titleId={titleId} />}
    </div>
  )
}
