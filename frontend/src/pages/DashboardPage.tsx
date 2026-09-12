import { useState } from 'react'
import { EARLY_PERIOD, HISTORY, RECENT_PERIOD, type DayRecord, type Period } from '../data/history'
import { Card, ComboChart, Legend, Stat } from '../components/ui'
import {
  delta,
  formatDuration,
  formatPercent,
  formatRate,
  mean,
  median,
  ratio,
} from '../lib/stats'

function summarize(days: DayRecord[]) {
  const valid = days.reduce((a, d) => a + d.validSeconds, 0)
  const good = days.reduce((a, d) => a + d.goodSeconds, 0)
  const excluded = days.reduce((a, d) => a + d.excludedSeconds, 0)
  const events = days.reduce((a, d) => a + d.events, 0)
  const alerts = days.reduce((a, d) => a + d.alerts, 0)
  const sessions = days.reduce((a, d) => a + d.sessions, 0)
  const intervals = days.flatMap((d) => d.intervals)
  const recoveries = days.flatMap((d) => d.recoveries)
  return {
    valid,
    good,
    excluded,
    events,
    alerts,
    sessions,
    intervals,
    recoveries,
    keepRate: ratio(good, valid),
    perHour: valid > 0 ? events / (valid / 3600) : null,
    meanInterval: mean(intervals),
    medianInterval: median(intervals),
    meanRecovery: mean(recoveries),
    medianRecovery: median(recoveries),
  }
}

type Tab = 'daily' | 'weekly' | 'compare'

export function DashboardPage() {
  const [tab, setTab] = useState<Tab>('daily')

  const today = HISTORY.slice(-1)
  const week = HISTORY.slice(-7)
  const prevWeek = HISTORY.slice(0, 7)
  const all = summarize(HISTORY)
  const tDay = summarize(today)
  const tWeek = summarize(week)
  const tPrev = summarize(prevWeek)

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">대시보드</h1>
          <p className="page-desc">
            모든 비율은 유효 측정 시간 기준이며, 판정 불가 구간은 집계에서 제외했습니다.
          </p>
        </div>
        <div className="row">
          {(
            [
              ['daily', '일별 기록'],
              ['weekly', '주간 비교'],
              ['compare', '전후 비교'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} className="chip" aria-pressed={tab === v} onClick={() => setTab(v)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Stat
          label="오늘 유지율"
          value={formatPercent(tDay.keepRate)}
          sub={`유효 측정 ${formatDuration(tDay.valid)}`}
        />
        <Stat
          label="이번 주 유지율"
          value={formatPercent(tWeek.keepRate)}
          sub={`세션 ${tWeek.sessions}회`}
          tone={tWeek.keepRate !== null && tWeek.keepRate >= 0.75 ? 'good' : undefined}
        />
        <Stat
          label="최근 14일 유지율"
          value={formatPercent(all.keepRate)}
          sub={`유효 측정 ${formatDuration(all.valid)}`}
        />
        <Stat
          label="판정 불가 (제외)"
          value={formatDuration(all.excluded)}
          sub={`전체 대비 ${((all.excluded / (all.valid + all.excluded)) * 100).toFixed(1)}%`}
        />
      </div>

      {tab === 'daily' && (
        <>
          <Card
            title="일별 유효 측정 시간과 유지율"
            note="막대는 유효 측정 시간, 선은 바른 자세 유지율입니다."
            className="grid"
          >
            <ComboChart
              bars={HISTORY.map((d) => ({
                label: d.label,
                sub: d.weekday,
                value: d.validSeconds / 3600,
              }))}
              line={HISTORY.map((d) => d.goodSeconds / d.validSeconds)}
              barUnit="시간"
              lineUnit="%"
            />
            <Legend
              items={[
                { color: 'var(--accent)', label: '유효 측정 시간' },
                { color: 'var(--good)', label: '바른 자세 유지율' },
              ]}
            />
          </Card>

          <div style={{ height: 14 }} />

          <Card title="일별 붕괴 이벤트" note="막대는 이벤트 수, 선은 시간당 붕괴 횟수입니다.">
            <ComboChart
              bars={HISTORY.map((d) => ({ label: d.label, sub: d.weekday, value: d.events }))}
              line={HISTORY.map((d) => d.events / (d.validSeconds / 3600))}
              barUnit="건"
              lineUnit="회"
              barColor="var(--bad)"
              lineColor="var(--warn)"
            />
            <Legend
              items={[
                { color: 'var(--bad)', label: '붕괴 이벤트 수' },
                { color: 'var(--warn)', label: '시간당 붕괴 횟수' },
              ]}
            />
          </Card>

          <div style={{ height: 14 }} />

          <Card title="일별 상세" note={`${HISTORY.length}일 기록`}>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th className="t-right">세션</th>
                    <th className="t-right">유효 측정</th>
                    <th className="t-right">판정 불가</th>
                    <th className="t-right">유지율</th>
                    <th className="t-right">이벤트</th>
                    <th className="t-right">알림</th>
                    <th className="t-right">평균 간격</th>
                    <th className="t-right">평균 회복</th>
                  </tr>
                </thead>
                <tbody>
                  {[...HISTORY].reverse().map((d) => {
                    const r = ratio(d.goodSeconds, d.validSeconds)
                    return (
                      <tr key={d.date}>
                        <td>
                          {d.label} ({d.weekday})
                        </td>
                        <td className="t-right">{d.sessions}</td>
                        <td className="t-right">{formatDuration(d.validSeconds)}</td>
                        <td className="t-right muted">{formatDuration(d.excludedSeconds)}</td>
                        <td
                          className="t-right"
                          style={{
                            color: r !== null && r >= 0.75 ? 'var(--good)' : 'var(--warn)',
                          }}
                        >
                          {formatPercent(r)}
                        </td>
                        <td className="t-right">{d.events}</td>
                        <td className="t-right">{d.alerts}</td>
                        <td className="t-right">{formatDuration(mean(d.intervals))}</td>
                        <td className="t-right">{formatDuration(mean(d.recoveries))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'weekly' && (
        <div className="grid g2">
          <Card title="이번 주" note={`${week[0].label} ~ ${week[week.length - 1].label}`}>
            <WeekBody s={tWeek} />
          </Card>
          <Card title="지난 주" note={`${prevWeek[0].label} ~ ${prevWeek[prevWeek.length - 1].label}`}>
            <WeekBody s={tPrev} />
          </Card>
          <Card title="주간 변화" className="g2" note="지난 주 대비 증감입니다.">
            <DeltaRow
              name="바른 자세 유지율"
              now={formatPercent(tWeek.keepRate)}
              diff={delta(tWeek.keepRate, tPrev.keepRate)}
              format={(v) => `${(v * 100).toFixed(1)}%p`}
              better="up"
            />
            <DeltaRow
              name="시간당 붕괴 횟수"
              now={formatRate(tWeek.perHour, '회')}
              diff={delta(tWeek.perHour, tPrev.perHour)}
              format={(v) => `${v.toFixed(2)}회`}
              better="down"
            />
            <DeltaRow
              name="평균 붕괴 발생 간격"
              now={formatDuration(tWeek.meanInterval)}
              diff={delta(tWeek.meanInterval, tPrev.meanInterval)}
              format={(v) => `${Math.round(v / 60)}분`}
              better="up"
            />
            <DeltaRow
              name="평균 회복 시간"
              now={formatDuration(tWeek.meanRecovery)}
              diff={delta(tWeek.meanRecovery, tPrev.meanRecovery)}
              format={(v) => `${Math.round(v)}초`}
              better="down"
            />
          </Card>
        </div>
      )}

      {tab === 'compare' && (
        <>
          <Card
            title="초기 구간과 최근 구간 비교"
            note="알림 횟수 감소만으로 개선을 판단하지 않도록 유지율과 붕괴 발생률을 함께 봅니다."
          >
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>지표</th>
                    <th className="t-right">{EARLY_PERIOD.title}</th>
                    <th className="t-right">{RECENT_PERIOD.title}</th>
                    <th className="t-right">변화</th>
                  </tr>
                </thead>
                <tbody>
                  <CompareRow
                    name="바른 자세 유지율"
                    a={formatPercent(summarize(EARLY_PERIOD.days).keepRate)}
                    b={formatPercent(summarize(RECENT_PERIOD.days).keepRate)}
                    diff={delta(
                      summarize(RECENT_PERIOD.days).keepRate,
                      summarize(EARLY_PERIOD.days).keepRate,
                    )}
                    format={(v) => `${(v * 100).toFixed(1)}%p`}
                    better="up"
                  />
                  <CompareRow
                    name="시간당 붕괴 횟수"
                    a={formatRate(summarize(EARLY_PERIOD.days).perHour, '회')}
                    b={formatRate(summarize(RECENT_PERIOD.days).perHour, '회')}
                    diff={delta(
                      summarize(RECENT_PERIOD.days).perHour,
                      summarize(EARLY_PERIOD.days).perHour,
                    )}
                    format={(v) => `${v.toFixed(2)}회`}
                    better="down"
                  />
                  <CompareRow
                    name="평균 붕괴 발생 간격"
                    a={formatDuration(summarize(EARLY_PERIOD.days).meanInterval)}
                    b={formatDuration(summarize(RECENT_PERIOD.days).meanInterval)}
                    diff={delta(
                      summarize(RECENT_PERIOD.days).meanInterval,
                      summarize(EARLY_PERIOD.days).meanInterval,
                    )}
                    format={(v) => `${Math.round(v / 60)}분`}
                    better="up"
                  />
                  <CompareRow
                    name="평균 회복 시간"
                    a={formatDuration(summarize(EARLY_PERIOD.days).meanRecovery)}
                    b={formatDuration(summarize(RECENT_PERIOD.days).meanRecovery)}
                    diff={delta(
                      summarize(RECENT_PERIOD.days).meanRecovery,
                      summarize(EARLY_PERIOD.days).meanRecovery,
                    )}
                    format={(v) => `${Math.round(v)}초`}
                    better="down"
                  />
                  <CompareRow
                    name="알림 횟수"
                    a={`${summarize(EARLY_PERIOD.days).alerts}회`}
                    b={`${summarize(RECENT_PERIOD.days).alerts}회`}
                    diff={
                      summarize(RECENT_PERIOD.days).alerts - summarize(EARLY_PERIOD.days).alerts
                    }
                    format={(v) => `${v}회`}
                    better="down"
                  />
                </tbody>
              </table>
            </div>
          </Card>

          <div style={{ height: 14 }} />

          <div className="grid g2">
            <PeriodMeta period={EARLY_PERIOD} />
            <PeriodMeta period={RECENT_PERIOD} />
          </div>
        </>
      )}
    </>
  )
}

function WeekBody({ s }: { s: ReturnType<typeof summarize> }) {
  return (
    <>
      <Row name="바른 자세 유지율" value={formatPercent(s.keepRate)} />
      <Row name="유효 측정 시간" value={formatDuration(s.valid)} />
      <Row name="세션 수" value={`${s.sessions}회`} />
      <Row name="붕괴 이벤트" value={`${s.events}건`} />
      <Row name="시간당 붕괴 횟수" value={formatRate(s.perHour, '회')} />
      <Row
        name="붕괴 발생 간격"
        value={`평균 ${formatDuration(s.meanInterval)} · 중앙값 ${formatDuration(
          s.medianInterval,
        )} · n=${s.intervals.length}`}
      />
      <Row
        name="회복 시간"
        value={`평균 ${formatDuration(s.meanRecovery)} · 중앙값 ${formatDuration(
          s.medianRecovery,
        )} · n=${s.recoveries.length}`}
      />
    </>
  )
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <div className="feature-row" style={{ gridTemplateColumns: '1fr auto' }}>
      <span className="feature-name">{name}</span>
      <span className="feature-value">{value}</span>
    </div>
  )
}

function DeltaRow({
  name,
  now,
  diff,
  format,
  better,
}: {
  name: string
  now: string
  diff: number | null
  format: (v: number) => string
  better: 'up' | 'down'
}) {
  const good = diff === null ? false : better === 'up' ? diff > 0 : diff < 0
  return (
    <div className="feature-row" style={{ gridTemplateColumns: '1fr auto auto', gap: 14 }}>
      <span className="feature-name">{name}</span>
      <span className="feature-value">{now}</span>
      <span className={`stat-delta ${good ? 'up' : 'down'}`} style={{ minWidth: 68, textAlign: 'right' }}>
        {diff === null ? '—' : `${diff > 0 ? '+' : '−'}${format(Math.abs(diff))}`}
      </span>
    </div>
  )
}

function CompareRow({
  name,
  a,
  b,
  diff,
  format,
  better,
}: {
  name: string
  a: string
  b: string
  diff: number | null
  format: (v: number) => string
  better: 'up' | 'down'
}) {
  const good = diff === null ? false : better === 'up' ? diff > 0 : diff < 0
  return (
    <tr>
      <td>{name}</td>
      <td className="t-right muted">{a}</td>
      <td className="t-right" style={{ fontWeight: 600 }}>
        {b}
      </td>
      <td className="t-right">
        <span className={`stat-delta ${good ? 'up' : 'down'}`}>
          {diff === null ? '—' : `${diff > 0 ? '+' : '−'}${format(Math.abs(diff))}`}
        </span>
      </td>
    </tr>
  )
}

function PeriodMeta({ period }: { period: Period }) {
  const s = summarize(period.days)
  return (
    <Card title={`${period.title} 기준 정보`} note="비교 결과를 읽을 때 함께 봐야 하는 값입니다.">
      <Row
        name="비교 기간"
        value={`${period.days[0].label} ~ ${period.days[period.days.length - 1].label}`}
      />
      <Row name="유효 측정 시간" value={formatDuration(s.valid)} />
      <Row name="세션 수" value={`${s.sessions}회`} />
      <Row name="모델 버전" value={period.modelVersion} />
    </Card>
  )
}
