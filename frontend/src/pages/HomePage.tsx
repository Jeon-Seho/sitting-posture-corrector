import { ArrowRight, Play } from '@phosphor-icons/react'
import { HISTORY, RECENT_SESSIONS } from '../data/history'
import { formatDuration, formatPercent, formatRate, mean, median, ratio } from '../lib/stats'
import { Card, ComboChart, Ledger, Legend, Rate, Stat } from '../components/ui'

export function HomePage({
  hasHistory,
  onStart,
  onDashboard,
}: {
  hasHistory: boolean
  onStart: () => void
  onDashboard: () => void
}) {
  const week = HISTORY.slice(-7)
  const valid = week.reduce((a, d) => a + d.validSeconds, 0)
  const good = week.reduce((a, d) => a + d.goodSeconds, 0)
  const events = week.reduce((a, d) => a + d.events, 0)
  const intervals = week.flatMap((d) => d.intervals)
  const keepRate = ratio(good, valid)
  const perHour = valid > 0 ? events / (valid / 3600) : null
  const sessions = week.reduce((a, d) => a + d.sessions, 0)

  if (!hasHistory) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1 className="page-title">홈</h1>
            <p className="page-desc">기록이 없는 상태의 시연 화면입니다. 현재 측정 결과는 저장되지 않습니다.</p>
          </div>
        </div>
        <div className="empty">
          <h2 className="empty-title">아직 측정 기록이 없습니다</h2>
          <p>
            첫 측정을 시작하면 바른 자세 유지율과 붕괴 주기를 분석해 드립니다. 측정 전에 카메라
            권한 확인과 기준 자세 보정을 한 번 거칩니다.
          </p>
          <button className="btn btn-primary btn-lg" style={{ marginTop: 8 }} onClick={onStart}>
            <Play size={18} weight="fill" className="icon" />첫 측정 시작하기
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">홈</h1>
          <p className="page-desc">발표용 예시 기록입니다. 실제 웹캠 측정 결과는 이 화면에 저장되지 않습니다.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={onStart}>
          <Play size={18} weight="fill" className="icon" />
          측정 시작
        </button>
      </div>

      <div className="gap-top">
        <Ledger cols={4}>
          <Stat
            label="바른 자세 유지율"
            value={formatPercent(keepRate)}
            sub={`유효 측정 ${formatDuration(valid)}`}
            tone={keepRate !== null && keepRate >= 0.75 ? 'good' : undefined}
          />
          <Stat
            label="평균 붕괴 발생 간격"
            value={formatDuration(mean(intervals))}
            sub={`중앙값 ${formatDuration(median(intervals))} · 표본 ${intervals.length}`}
          />
          <Stat
            label="시간당 붕괴 횟수"
            value={formatRate(perHour, '회')}
            sub={`이벤트 ${events}건`}
          />
          <Stat
            label="측정 세션"
            value={`${sessions}회`}
            sub={`최근 7일 · 하루 평균 ${(sessions / 7).toFixed(1)}회`}
          />
        </Ledger>
      </div>

      <div className="grid split gap-top">
        <Card title="일별 바른 자세 유지율" note="막대는 유효 측정 시간, 선은 유지율입니다.">
          <ComboChart
            bars={week.map((d) => ({
              label: d.label,
              sub: d.weekday,
              value: d.validSeconds / 3600,
            }))}
            line={week.map((d) => d.goodSeconds / d.validSeconds)}
            barUnit="시간"
            lineUnit="%"
          />
          <Legend
            items={[
              { color: 'var(--ink)', label: '유효 측정 시간' },
              { color: 'var(--accent)', label: '바른 자세 유지율' },
            ]}
          />
        </Card>

        <Card title="이번 주 상태" note="유효 측정 시간에서 판정 불가 구간은 제외됩니다." dark>
          <Rate value={keepRate} label="유지율" />
          <div className="divider" />
          <div className="feature-row" style={{ gridTemplateColumns: '1fr auto' }}>
            <span className="feature-name">바른 자세</span>
            <span className="feature-value">{formatDuration(good)}</span>
          </div>
          <div className="feature-row" style={{ gridTemplateColumns: '1fr auto' }}>
            <span className="feature-name">자세 붕괴</span>
            <span className="feature-value">{formatDuration(valid - good)}</span>
          </div>
          <div className="feature-row" style={{ gridTemplateColumns: '1fr auto' }}>
            <span className="feature-name">판정 불가(제외)</span>
            <span className="feature-value">
              {formatDuration(week.reduce((a, d) => a + d.excludedSeconds, 0))}
            </span>
          </div>
          <div className="feature-row" style={{ gridTemplateColumns: '1fr auto' }}>
            <span className="feature-name">알림 발생</span>
            <span className="feature-value">{week.reduce((a, d) => a + d.alerts, 0)}회</span>
          </div>
        </Card>
      </div>

      <Card
        title="최근 측정"
        note="세션 단위 기록입니다."
        action={
          <button className="btn btn-sm" onClick={onDashboard}>
            대시보드에서 보기
            <ArrowRight size={15} weight="bold" className="icon" />
          </button>
        }
      >
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>세션</th>
                <th>시작</th>
                <th className="t-right">유효 측정 시간</th>
                <th className="t-right">유지율</th>
                <th className="t-right">붕괴 이벤트</th>
              </tr>
            </thead>
            <tbody>
              {RECENT_SESSIONS.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.id}</td>
                  <td>{s.startedAt}</td>
                  <td className="t-right">{formatDuration(s.validSeconds)}</td>
                  <td className={`t-right ${s.keepRate >= 0.75 ? 't-good' : 't-warn'}`}>
                    {formatPercent(s.keepRate)}
                  </td>
                  <td className="t-right">{s.events}건</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
