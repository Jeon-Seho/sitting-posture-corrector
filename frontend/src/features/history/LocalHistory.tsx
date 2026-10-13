import { useEffect, useState } from 'react'
import { Segmented } from '../../components/Segmented'
import { Play } from '@phosphor-icons/react'
import { RecordComparison } from '../../components/RecordComparison'
import { historyFor, localDay, type HistoryMode, type Period } from '../../lib/history'
import { summary, type RecordItem } from '../../lib/serviceStore'
import { formatDuration, formatRate } from '../../lib/stats'
import { DailyDetail } from './DailyDetail'
import { Card, ComboChart, Ledger, Legend, Stat } from '../../components/ui'
import { GOOD_RATE } from '../../components/RateRing'

const PERIODS: [Period, string, string][] = [
  ['today', '오늘', '오늘 기록'],
  ['week', '최근 7일', '이번 주 기록'],
  ['month', '최근 30일', '이번 달 기록'],
  ['all', '전체', '전체 기록'],
]

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/**
 * Records tab. Everything here is computed from the saved session summaries in the
 * current workspace. When the platform report API is ready (daily mart), the period
 * totals and daily bars can come from it instead — see docs/design/frontend-platform-seams.md.
 */
export function LocalHistory({
  records,
  measuring,
  onStart,
  accountMode = false,
  todayRequest = 0,
}: {
  records: RecordItem[]
  /** Changes each time the sidebar's today card is pressed: show the "today" period. */
  todayRequest?: number
  measuring: boolean
  onStart: () => void
  accountMode?: boolean
}) {
  const [mode, setMode] = useState<HistoryMode>('all')
  const [period, setPeriod] = useState<Period>(todayRequest ? 'today' : 'week')
  useEffect(() => {
    if (todayRequest) setPeriod('today')
  }, [todayRequest])
  const now = new Date()
  const hasDemo = records.some((r) => r.mode === 'demo')
  const selected = historyFor(records, mode, period, now)
  const stats = summary(selected)
  const alerts = selected.reduce((n, r) => n + r.events.reduce((a, e) => a + e.alerts, 0), 0)
  const days = dayBars(records.filter((r) => mode === 'all' || r.mode === mode), period === 'month' ? 30 : 7, now)
  const total = selected.reduce((n, r) => n + r.total, 0)
  const excluded = selected.reduce((n, r) => n + Math.max(0, r.total - r.valid), 0)
  const title = PERIODS.find(([id]) => id === period)![2]
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-desc">
            {localDay(now.toISOString())} 기준
            {hasDemo &&
              ` · ${mode === 'all' ? '실제 웹캠·합성 시연 합산' : mode === 'camera' ? '실제 웹캠 기록' : '합성 시연 기록'}`}{' '}
            · {accountMode ? '내 계정에 저장된 요약' : '이 기기에 저장된 요약'}
          </p>
        </div>
        <div className="page-actions">
          <Segmented label="기록 조회 기간">
            {PERIODS.map(([id, label]) => (
              <button key={id} aria-pressed={period === id} onClick={() => setPeriod(id)}>
                {label}
              </button>
            ))}
          </Segmented>
        </div>
      </div>

      {hasDemo && (
        <div className="row" role="group" aria-label="기록 종류" style={{ flexWrap: 'wrap' }}>
          {(
            [
              ['all', '모든 기록'],
              ['camera', '실제 웹캠 기록'],
              ['demo', '합성 시연 기록'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className="chip" aria-pressed={mode === id} onClick={() => setMode(id)}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="records-stack">
        <Ledger cols={4}>
          <Stat
            dataStat="rate"
            label="바른 자세 유지율"
            value={stats.rate === null ? '—' : `${Math.round(stats.rate * 100)}%`}
            sub="측정한 시간 가운데 기준 자세를 유지한 비율"
            tone={stats.rate !== null && stats.rate >= GOOD_RATE ? 'good' : undefined}
          />
          <Stat
            dataStat="valid"
            label="측정한 시간"
            value={formatDuration(stats.valid)}
            sub={
              <>
                세션 <span data-stat="count">{selected.length}</span>회 · 확인 못 한 시간 제외
              </>
            }
          />
          <Stat
            dataStat="alerts"
            label="받은 알림"
            value={`${alerts}회`}
            sub={
              stats.valid >= 1800
                ? `한 시간에 ${formatRate(alerts / (stats.valid / 3600), '회')} 정도`
                : stats.valid > 0
                  ? '30분 이상 측정하면 시간당 횟수를 보여 드려요'
                  : '측정 후에 계산돼요'
            }
          />
          <Stat
            label="판정 불가 (제외)"
            value={formatDuration(excluded)}
            sub={total > 0 ? `전체 시간의 ${((excluded / total) * 100).toFixed(1)}%` : '측정 후에 계산돼요'}
          />
        </Ledger>

        <Card title="날짜별 유지율과 측정 시간" note="막대는 바른 자세 유지율, 선은 측정한 시간이에요.">
          <ComboChart
            bars={days.map((d) => ({ label: d.label, sub: d.sub, value: d.rate }))}
            line={days.map((d) => (d.valid > 0 ? d.valid / 3600 : null))}
            barUnit="%"
            lineUnit="시간"
            barMax={1}
            barName="바른 자세 유지율"
            lineName="측정한 시간"
            formatBar={(rate) => `${(rate * 100).toFixed(1)}%`}
            formatLine={(hours) => formatDuration(hours * 3600)}
            details={(i) => [
              { label: '세션', value: `${days[i].sessions}회` },
              { label: '알림', value: `${days[i].alerts}회` },
            ]}
          />
          <Legend
            items={[
              { color: 'var(--primary-soft)', label: '바른 자세 유지율' },
              { color: 'var(--primary)', label: '측정한 시간' },
            ]}
          />
        </Card>

        <Card title="일별 상세" note={selected.length ? '원을 누르면 그날의 세션을 볼 수 있어요' : undefined}>
          <DailyDetail records={selected} allStarts={records.map((r) => r.startedAt)} />
          {selected.length === 0 && (
            <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={onStart}>
              <Play size={15} weight="fill" className="icon" />
              {measuring ? '진행 중인 측정으로' : '측정 시작'}
            </button>
          )}
        </Card>

        <details className="more">
          <summary>처음과 최근 비교</summary>
          <div className="more-body">
            <p className="fine">
              조회 기간과 별도로, 선택한 기록 종류의 전체 기록을 사용합니다. 합성 시연 결과는 실제 자세
              개선 근거가 아닙니다.
            </p>
            <RecordComparison records={records.filter((r) => mode === 'all' || r.mode === mode)} />
          </div>
        </details>
      </div>
    </>
  )
}

function dayBars(records: RecordItem[], count: number, now: Date) {
  const todayKey = localDay(now.toISOString())
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(now)
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - (count - 1 - i))
    const key = localDay(date.toISOString())
    const dayRecords = records.filter((r) => localDay(r.startedAt) === key)
    const day = summary(dayRecords)
    return {
      key,
      date,
      today: key === todayKey,
      label: count <= 7 ? `${date.getMonth() + 1}/${date.getDate()}` : String(date.getDate()),
      sub: count <= 7 ? WEEKDAY[date.getDay()] : undefined,
      rate: day.rate,
      valid: day.valid,
      sessions: dayRecords.length,
      alerts: dayRecords.reduce((n, r) => n + r.events.reduce((a, e) => a + e.alerts, 0), 0),
      title: `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY[date.getDay()]})`,
    }
  })
}
