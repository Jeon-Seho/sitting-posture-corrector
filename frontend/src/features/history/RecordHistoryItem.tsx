import { useId, useState } from 'react'
import { CaretDown, Clock } from '@phosphor-icons/react'
import { RECORD_SOURCE_LABEL, recordSource } from '../../lib/comparison'
import type { RecordItem } from '../../lib/serviceStore'
import { formatDuration } from '../../lib/stats'
import { RateRing } from '../../components/RateRing'
import { RecordDetails } from './RecordDetails'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/** "10/2 (금) 오후 4:57": short enough for the 320px side column. */
function shortDate(iso: string) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY[d.getDay()]}) ${time}`
}

/** `sessionNumber`: order of this session within its day (1 = first session that day). */
export function RecordHistoryItem({ record, sessionNumber }: { record: RecordItem; sessionNumber?: number }) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const titleId = `${detailsId}-title`
  const date = sessionNumber
    ? `세션 ${sessionNumber} · ${new Date(record.startedAt).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}`
    : shortDate(record.startedAt)
  const rate = record.valid ? record.good / record.valid : null
  return (
    <div className="history-record">
      {/* The whole row opens the details (2026-10-13); the button stays for keyboard and screen readers. */}
      <div
        className={`service-record history-record-row ${expanded ? 'is-open' : ''}`}
        onClick={() => setExpanded((previous) => !previous)}
      >
        <span className="service-record-icon" aria-hidden="true">
          <Clock size={20} weight="bold" />
        </span>
        <div className="service-record-text">
          <strong>{date}</strong>
          <span title={RECORD_SOURCE_LABEL[recordSource(record)]}>
            {formatDuration(record.valid)} 측정 · 자세 경고 {record.events.length}번
            {record.server && !record.server.confirmed && ' · 서버 종료 미확인'}
          </span>
        </div>
        <RateRing rate={rate} size={46} />
        <button
          type="button"
          className="btn btn-icon btn-sm history-detail-button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${date} 기록 상세 ${expanded ? '닫기' : '보기'}`}
          title={expanded ? '닫기' : '자세히'}
          onClick={(event) => {
            event.stopPropagation()
            setExpanded((previous) => !previous)
          }}
        >
          <CaretDown size={16} weight="bold" className="icon" />
          <span className="sr-only">{expanded ? '닫기' : '자세히'}</span>
        </button>
      </div>
      {expanded && <RecordDetails record={record} id={detailsId} titleId={titleId} />}
    </div>
  )
}
