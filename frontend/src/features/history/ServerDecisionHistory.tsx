import { ExpandableTable } from '../../components/ExpandableTable'
import type { DecisionEvent, SessionView } from '../session/server/contracts'
import { formatClock } from '../../lib/stats'

const EVENT_LABEL: Record<DecisionEvent['kind'], string> = {
  collapse_confirmed: '이탈 확정',
  recovery_confirmed: '복귀 확인',
  reminder: '같은 사건 재알림',
  interrupted: '사건 중단',
  session_ended: '세션 종료 확인',
}
const DIRECTION_LABEL: Record<DecisionEvent['deviation_type'], string> = {
  none: '변화 없음',
  forward_slouch: '앞쪽 자세 변화',
  left_lean: '왼쪽 기울어짐',
  right_lean: '오른쪽 기울어짐',
  unspecified: '기준 대비 변화 · 방향 미분류',
}
const REASON_LABEL: Record<NonNullable<DecisionEvent['reason']>, string> = {
  missing: '관측 시간 공백',
  missing_sequence: '관측 순서 누락',
  unmeasurable: '측정 불가',
  rest: '휴식',
  away: '자리 비움',
  ended: '측정 종료',
}

export function formatElapsed(milliseconds: number) {
  const remainder = Math.round(milliseconds % 1000)
  return `${formatClock(milliseconds / 1000)}${remainder ? `.${String(remainder).padStart(3, '0')}` : ''}`
}

export function ServerDecisionHistory({
  view,
  confirmed,
}: {
  view: SessionView
  confirmed: boolean
}) {
  const openEvent = view.events.reduce((open, event) => {
    if (event.kind === 'collapse_confirmed') return true
    if (event.kind === 'reminder') return open
    return false
  }, false)
  return (
    <div className="history-event-history">
      <h5>서버가 확인한 사건 이력</h5>
      <p className="fine">
        알림·복귀·중단을 각각 표시합니다. 재알림은 새 이탈 사건이 아닙니다. 좌우 방향은 미러 카메라
        화면 기준이며, 시각은 측정 시작 이후 시간입니다.
      </p>
      {!confirmed && openEvent && (
        <p className="history-warning">
          마지막 서버 확인 시 이탈 사건이 계속 중이었습니다. 이후 복귀·종료 여부는 확인되지
          않았습니다.
        </p>
      )}
      {view.events.length === 0 ? (
        <p>서버에 확인된 사건이 없습니다.</p>
      ) : (
        <ExpandableTable>
          <table className="history-events-table">
            <thead>
              <tr>
                <th>순서</th>
                <th>내용</th>
                <th>확인 시각</th>
                <th>방향·유형</th>
                <th>사건 시작</th>
                <th>중단·종료 사유</th>
              </tr>
            </thead>
            <tbody>
              {view.events.map((event) => (
                <tr key={event.event_id}>
                  <td>{event.event_id}</td>
                  <td>{EVENT_LABEL[event.kind]}</td>
                  <td>{formatElapsed(event.timestamp_ms)}</td>
                  <td>{DIRECTION_LABEL[event.deviation_type]}</td>
                  <td>
                    {event.kind === 'session_ended' ? (
                      '해당 없음'
                    ) : (
                      <>
                        <span>{formatElapsed(event.onset_ms)}</span>
                        <span className="fine">
                          유효 시간 기준 {formatElapsed(event.onset_valid_ms)}
                        </span>
                      </>
                    )}
                  </td>
                  <td>{event.reason === null ? '해당 없음' : REASON_LABEL[event.reason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ExpandableTable>
      )}
    </div>
  )
}
