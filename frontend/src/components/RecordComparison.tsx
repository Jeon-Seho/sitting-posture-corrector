import { Card } from './ui'
import { CompareRow, Row } from '../pages/DashboardPage'
import { COMPARE_RULES, compareFirstAndRecent, type PeriodStats } from '../lib/comparison'
import type { RecordItem } from '../lib/serviceStore'
import { delta, formatDuration, formatPercent, formatRate } from '../lib/stats'

const label = (key: string) => { const [, m, d] = key.split('-'); return `${Number(m)}/${Number(d)}` }

/** 실제 기록의 첫 측정 구간과 최근 구간 비교. 표 모양은 예시 대시보드와 같다. */
export function RecordComparison({ records }: { records: RecordItem[] }) {
  const result = compareFirstAndRecent(records)
  const days = COMPARE_RULES.days
  const note = `첫 측정일부터 ${days}일과 최근 ${days}일을 비교합니다. 알림 횟수 감소만으로 개선을 판단하지 않도록 유지율과 붕괴 발생률을 함께 봅니다.`
  if (result.status === 'empty' || result.status === 'waiting') {
    return (
      <Card title="처음과 최근 비교" note={note}>
        <p className="profile-text">
          {result.status === 'empty'
            ? '측정 기록이 쌓이면 처음과 최근을 비교해 보여 드립니다.'
            : `첫 측정일(${label(result.firstDay)})부터 ${days * 2}일이 지나야 비교할 수 있습니다. ${result.daysLeft}일 남았습니다.`}
        </p>
      </Card>
    )
  }
  const { early, recent } = result
  return (
    <>
      <Card title="처음과 최근 비교" note={note}>
        {result.status === 'short' && (
          <p className="profile-text">
            한쪽 구간의 유효 측정 시간이 {formatDuration(COMPARE_RULES.minValidSeconds)} 미만이라 변화는 참고용입니다.
          </p>
        )}
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>지표</th>
                <th className="t-right">처음 {days}일</th>
                <th className="t-right">최근 {days}일</th>
                <th className="t-right">변화</th>
              </tr>
            </thead>
            <tbody>
              <CompareRow name="바른 자세 유지율" a={formatPercent(early.keepRate)} b={formatPercent(recent.keepRate)}
                diff={delta(recent.keepRate, early.keepRate)} format={v => `${(v * 100).toFixed(1)}%p`} better="up" />
              <CompareRow name="시간당 붕괴 횟수" a={formatRate(early.perHour, '회')} b={formatRate(recent.perHour, '회')}
                diff={delta(recent.perHour, early.perHour)} format={v => `${v.toFixed(2)}회`} better="down" />
              <CompareRow name="평균 붕괴 발생 간격" a={formatDuration(early.meanInterval)} b={formatDuration(recent.meanInterval)}
                diff={delta(recent.meanInterval, early.meanInterval)} format={v => formatDuration(v)} better="up" />
              <CompareRow name="평균 회복 시간" a={formatDuration(early.meanRecovery)} b={formatDuration(recent.meanRecovery)}
                diff={delta(recent.meanRecovery, early.meanRecovery)} format={v => `${Math.round(v)}초`} better="down" />
              <CompareRow name="알림 횟수" a={`${early.alerts}회`} b={`${recent.alerts}회`}
                diff={recent.alerts - early.alerts} format={v => `${v}회`} better="down" />
            </tbody>
          </table>
        </div>
      </Card>
      <div style={{ height: 22 }} />
      <div className="grid g2">
        <PeriodInfo title={`처음 ${days}일`} stats={early} />
        <PeriodInfo title={`최근 ${days}일`} stats={recent} />
      </div>
    </>
  )
}

function PeriodInfo({ title, stats }: { title: string; stats: PeriodStats }) {
  return (
    <Card title={`${title} 기준 정보`} note="비교 결과를 읽을 때 함께 봐야 하는 값입니다.">
      <Row name="비교 기간" value={`${label(stats.from)} ~ ${label(stats.to)}`} />
      <Row name="유효 측정 시간" value={formatDuration(stats.valid)} />
      <Row name="세션 수" value={`${stats.sessions}회`} />
    </Card>
  )
}
