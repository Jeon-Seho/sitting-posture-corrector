import { HISTORY, RECENT_SESSIONS } from '../data/history'
import { formatDuration, formatPercent, formatRate, mean, median, ratio } from '../lib/stats'
import { Card, ComboChart, Ring, Stat } from '../components/ui'

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

  if (!hasHistory) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1 className="page-title">홈</h1>
            <p className="page-desc">측정 기록이 쌓이면 요약 통계가 여기에 표시됩니다.</p>
          </div>
        </div>
        <div className="empty">
          <div style={{ fontSize: 15, color: 'var(--text)', fontWeight: 600 }}>
            아직 측정 기록이 없습니다
          </div>
          <p style={{ marginTop: 6, fontSize: 13 }}>
            첫 측정을 시작하면 바른 자세 유지율과 붕괴 주기를 분석해 드립니다.
            <br />
            측정 전에 카메라 권한 확인과 기준 자세 보정을 한 번 거칩니다.
          </p>
          <button className="btn btn-primary btn-lg" style={{ marginTop: 18 }} onClick={onStart}>
            첫 측정 시작하기
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
          <p className="page-desc">최근 7일 요약입니다. 유효 측정 시간 기준으로 계산했습니다.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={onStart}>
          측정 시작
        </button>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
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
          value={`${week.reduce((a, d) => a + d.sessions, 0)}회`}
          sub={`최근 7일 · 하루 평균 ${(
            week.reduce((a, d) => a + d.sessions, 0) / 7
          ).toFixed(1)}회`}
        />
      </div>

      <div className="grid g2" style={{ marginBottom: 14 }}>
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
        </Card>

        <Card title="이번 주 상태" note="유효 측정 시간에서 판정 불가 구간은 제외됩니다.">
          <div className="row" style={{ gap: 20, alignItems: 'center' }}>
            <Ring value={keepRate} label="유지율" />
            <div style={{ flex: 1 }}>
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
                <span className="feature-value">
                  {week.reduce((a, d) => a + d.alerts, 0)}회
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="최근 측정"
        note="세션 단위 기록입니다."
        action={
          <button className="btn btn-sm" onClick={onDashboard}>
            대시보드에서 보기
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
                  <td
                    className="t-right"
                    style={{ color: s.keepRate >= 0.75 ? 'var(--good)' : 'var(--warn)' }}
                  >
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
