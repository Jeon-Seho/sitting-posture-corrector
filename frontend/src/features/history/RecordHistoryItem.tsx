import { useId, useState } from 'react'
import { CaretDown, Clock } from '@phosphor-icons/react'
import { RECORD_SOURCE_LABEL, recordSource } from '../../lib/comparison'
import type { RecordItem } from '../../lib/serviceStore'
import { formatDuration, formatPercent } from '../../lib/stats'
import { RecordDetails } from './RecordDetails'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/** "10/2 (금) 오후 4:57": short enough for the 320px side column. */
function shortDate(iso: string) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY[d.getDay()]}) ${time}`
}

export function RecordHistoryItem({ record }: { record: RecordItem }) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const titleId = `${detailsId}-title`
  const date = shortDate(record.startedAt)
  const rate = record.valid ? record.good / record.valid : null
  const alerts = record.events.reduce((n, e) => n + e.alerts, 0)
  return (
    <div className="history-record">
      <div className="service-record">
        <span className="service-record-icon" aria-hidden="true">
          <Clock size={20} weight="bold" />
        </span>
        <div className="service-record-text">
          <strong>{date}</strong>
          <span title={RECORD_SOURCE_LABEL[recordSource(record)]}>
            {formatDuration(record.valid)} 측정 · 알림 {alerts}회
            {record.evaluationCounts&&' · 머리/상체 범위 구분'}
            {record.server && !record.server.confirmed && ' · 서버 종료 미확인'}
          </span>
        </div>
        <b className={rate !== null && rate >= 0.85 ? 'good' : ''}>{formatPercent(rate, 0)}</b>
        <button
          type="button"
          className="btn btn-icon btn-sm history-detail-button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${date} 기록 상세 ${expanded ? '닫기' : '보기'}`}
          title={expanded ? '닫기' : '자세히'}
          onClick={() => setExpanded((previous) => !previous)}
        >
          <CaretDown size={16} weight="bold" className="icon" />
          <span className="sr-only">{expanded ? '닫기' : '자세히'}</span>
        </button>
      </div>
      {expanded && <RecordDetails record={record} id={detailsId} titleId={titleId} />}
    </div>
  )
}
