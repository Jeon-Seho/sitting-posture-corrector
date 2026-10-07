import { ExpandableTable } from '../../components/ExpandableTable'
import { COLLAPSE_LABEL } from '../../data/posture'
import type { CollapseEvent } from '../../lib/engine'
import { formatClock, formatDuration } from '../../lib/stats'

export function EventItem({ event: e, muted }: { event: CollapseEvent; muted: boolean }) {
  return (
    <div className="event-item">
      <div className="top">
        <span>
          <span className="figure">#{e.id}</span>
          {e.evaluationScope==='head'?'머리 기울기 (상체 제외)':COLLAPSE_LABEL[e.type]}
        </span>
        {e.endAt === null ? (
          <span className="badge collapse">
            <i className="pip" />
            진행 중
          </span>
        ) : e.endReason ? (
          <span className="badge unknown">
            <i className="pip" />
            {e.endReason === 'paused'
              ? '휴식으로 중단'
              : e.endReason === 'unknown'
                ? '측정 불가로 중단'
                : '세션 종료로 중단'}
          </span>
        ) : (
          <span className="badge good">
            <i className="pip" />
            복귀
          </span>
        )}
      </div>
      <div className="event-meta">
        <span>시작 {formatClock(e.startAt)}</span>
        <span>지속 {e.endAt === null ? '—' : formatDuration(e.durationSec)}</span>
        <span>알림 {e.alerts}회</span>
        <span>회복 {e.recoverySec === null ? '—' : formatDuration(e.recoverySec)}</span>
        {muted && <span className="warn">알림 꺼짐</span>}
      </div>
    </div>
  )
}

export function EventTable({ events, muted }: { events: CollapseEvent[]; muted: Set<number> }) {
  if (events.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 14 }}>
        기록된 이벤트가 없습니다.
      </p>
    )
  }
  return (
    <ExpandableTable>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>유형</th>
            <th>시작</th>
            <th>종료</th>
            <th className="t-right">지속</th>
            <th className="t-right">알림</th>
            <th className="t-right">회복 시간</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {[...events]
            .sort((a, b) => a.id - b.id)
            .map((e) => (
              <tr key={e.id}>
                <td>{e.id}</td>
                <td>{e.evaluationScope==='head'?'머리 기울기 (상체 제외)':COLLAPSE_LABEL[e.type]}</td>
                <td>{formatClock(e.startAt)}</td>
                <td>{e.endAt === null ? '—' : formatClock(e.endAt)}</td>
                <td className="t-right">
                  {e.endAt === null ? '—' : formatDuration(e.durationSec)}
                </td>
                <td className="t-right">{e.alerts}회</td>
                <td className="t-right">
                  {e.recoverySec === null ? '—' : formatDuration(e.recoverySec)}
                </td>
                <td>
                  {e.endReason
                    ? e.endReason === 'paused'
                      ? '휴식으로 중단'
                      : e.endReason === 'unknown'
                        ? '측정 불가로 중단'
                        : '세션 종료로 중단'
                    : e.recovered
                      ? muted.has(e.id)
                        ? '복귀 (알림 꺼짐)'
                        : '복귀'
                      : '진행 중'}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </ExpandableTable>
  )
}
