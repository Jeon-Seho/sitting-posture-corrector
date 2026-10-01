import { useId, useState } from 'react'
import { RECORD_SOURCE_LABEL, recordedRules, recordSource } from '../../lib/comparison'
import type { RecordItem } from '../../lib/serviceStore'
import { formatDuration, formatPercent } from '../../lib/stats'
import { RecordDetails } from './RecordDetails'

export function RecordHistoryItem({ record }: { record: RecordItem }) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const titleId = `${detailsId}-title`
  const date = new Date(record.startedAt).toLocaleString()
  const rules = recordedRules(record)
  const rate = record.valid ? record.good / record.valid : null
  return (
    <div className="history-record">
      <div className="service-record">
        <div>
          <strong>{date}</strong>
          <span>
            {RECORD_SOURCE_LABEL[recordSource(record)]} · {formatDuration(record.valid)} ·{' '}
            {record.events.length}건
            {record.server && !record.server.confirmed && ' · 서버 종료 미확인'}
            {rules && ` · 확정 ${rules.holdSeconds}초 / 재알림 ${rules.realertSeconds}초`}
          </span>
        </div>
        <div className="service-bar">
          <span style={{ width: `${(rate ?? 0) * 100}%` }} />
        </div>
        <b>{formatPercent(rate)}</b>
        <button
          type="button"
          className="btn history-detail-button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${date} 기록 상세 ${expanded ? '닫기' : '보기'}`}
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded ? '상세 닫기' : '상세 보기'}
        </button>
      </div>
      {expanded && <RecordDetails record={record} id={detailsId} titleId={titleId} />}
    </div>
  )
}
