import { RECORD_SOURCE_LABEL, periodStats, recordedRules, recordSource } from '../../lib/comparison'
import type { ReactNode } from 'react'
import type { RecordItem } from '../../lib/serviceStore'
import { formatDuration, formatPercent, formatRate } from '../../lib/stats'
import { EventTable } from '../session/SessionEvents'
import { RuleDescription } from './RuleDescription'
import { ServerDecisionHistory } from './ServerDecisionHistory'

const EMPTY_MUTED = new Set<number>()

/** Stored server facts remain authoritative, including an unfinished remote session. */
export function RecordDetails({
  record,
  id,
  titleId,
}: {
  record: RecordItem
  id: string
  titleId: string
}) {
  const server = record.server
  const view = server?.view
  const rules = recordedRules(record)
  const stats = periodStats([record], '', '')
  const alerts = view?.summary.alert_count ?? stats.alerts
  return (
    <section id={id} aria-labelledby={titleId} className="history-record-details">
      <h4 id={titleId}>측정 기록 상세</h4>
      <p className="fine">{RECORD_SOURCE_LABEL[recordSource(record)]}</p>
      {server && (
        <p className={server.confirmed ? 'history-confirmed' : 'history-warning'}>
          {server.confirmed
            ? '서버 종료 확인 · 종료 응답까지 반영한 결과입니다.'
            : '서버 종료 미확인 · 마지막으로 확인된 서버 요약만 보관한 결과입니다. 이후 시간과 복귀 여부는 알 수 없습니다.'}
        </p>
      )}
      {record.mode === 'demo' && (
        <p className="history-warning">
          합성 시연 기록입니다. 실제 자세 개선의 근거로 사용할 수 없습니다.
        </p>
      )}
      <dl className="history-detail-grid">
        <Fact label="측정 시작" value={new Date(record.startedAt).toLocaleString()} />
        <Fact
          label={server && !server.confirmed ? '요약 보관 시각' : '기록 종료 시각'}
          value={new Date(record.endedAt).toLocaleString()}
        />
        <Fact label="집계된 전체 시간" value={duration(record.total)} />
        <Fact label="유효 측정 시간" value={duration(record.valid)} />
        <Fact label="기준 자세 유지 시간" value={duration(record.good)} />
        <Fact
          label="기준 대비 이탈 시간"
          value={duration(view ? view.summary.deviation_ms / 1000 : record.valid - record.good)}
        />
        <Fact label="집계 제외 시간" value={duration(record.total - record.valid)} />
        <Fact
          label="기준 자세 유지율"
          value={formatPercent(view ? view.summary.keep_rate : stats.keepRate)}
        />
        <Fact
          label="이탈 사건"
          value={`${view?.summary.collapse_count ?? record.events.length}건`}
        />
        <Fact label="알림" value={`${alerts}회`} />
        <Fact
          label="시간당 이탈 사건"
          value={formatRate(view ? view.summary.events_per_hour : stats.perHour, '회')}
        />
        <Fact
          label="평균 발생 간격"
          value={formatDuration(view ? seconds(view.summary.mean_interval_ms) : stats.meanInterval)}
        />
        <Fact
          label="평균 회복 시간"
          value={formatDuration(view ? seconds(view.summary.mean_recovery_ms) : stats.meanRecovery)}
        />
      </dl>
      {view ? (
        <>
          <h5>집계 제외 시간의 구성</h5>
          <dl className="history-detail-grid">
            <Fact label="휴식" value={duration(view.summary.rest_ms / 1000)} />
            <Fact label="자리 비움" value={duration(view.summary.away_ms / 1000)} />
            <Fact label="측정 불가" value={duration(view.summary.unknown_ms / 1000)} />
            <Fact label="관측 공백·누락" value={duration(view.summary.missing_ms / 1000)} />
          </dl>
          <p className="fine">
            유효 시간 0이면 유지율·시간당 발생률은 계산 불가입니다. 평균 간격과 회복 시간도 확인된
            값이 없으면 계산 불가입니다.
          </p>
        </>
      ) : (
        <p className="fine">
          {server
            ? '서버 상세 응답이 기록에 없습니다. 확인된 측정 시간과 추론 모델을 알 수 없습니다.'
            : '휴식·자리 비움·측정 불가·관측 공백별 제외 시간은 기록에 남아 있지 않아 구분할 수 없습니다.'}
        </p>
      )}
      <div className="history-applied-rules">
        <h5>이 측정에 적용한 설정</h5>
        {rules ? <RuleDescription rules={rules} /> : <p>기록에 적용 설정이 남아 있지 않습니다.</p>}
      </div>
      <details className="history-model-details">
        <summary>개인 기준·모델 정보</summary>
        <dl className="history-detail-grid">
          <Fact label="개인 기준 ID" value={baselineValue(record)} />
          <Fact label="모델 버전" value={modelVersionValue(record)} />
        </dl>
        {!server && record.mode === 'camera' && (
          <p className="fine">현재 등록된 기준이나 모델로 과거 기록의 조건을 추정하지 않습니다.</p>
        )}
      </details>
      {view && server ? (
        <ServerDecisionHistory view={view} confirmed={server.confirmed} />
      ) : !server ? (
        <div className="history-event-history">
          <h5>기록된 이탈 사건</h5>
          <p className="fine">
            시작·종료는 측정 시작 이후 시간입니다. 휴식·측정 불가·세션 종료로 중단된 사건은 복귀로
            계산하지 않습니다.
          </p>
          <EventTable events={record.events} muted={EMPTY_MUTED} />
        </div>
      ) : null}
    </section>
  )
}

function seconds(milliseconds: number | null) {
  return milliseconds === null ? null : milliseconds / 1000
}
function duration(seconds: number) {
  return `${seconds.toLocaleString('ko-KR', { maximumFractionDigits: 3 })}초`
}

function baselineValue(record: RecordItem): ReactNode {
  if (record.server) return <code>{record.server.baselineId}</code>
  if (record.mode === 'demo') return '합성 시연 · 실제 개인 기준 없음'
  return '알 수 없음 · 기준 ID가 기록에 없음'
}

function modelVersionValue(record: RecordItem): ReactNode {
  const server = record.server
  if (!server) return '알 수 없음 · 모델 버전이 기록에 없음'
  if (!server.view) return '확인할 수 없음 · 서버 상세 응답 없음'
  if (server.modelVersion === 'unmeasured') return '확인할 수 없음 · 추론 결과 없음'
  return <code>{server.modelVersion}</code>
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
