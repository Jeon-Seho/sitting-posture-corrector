import { useState } from 'react'
import { Segmented } from '../../components/Segmented'
import { Play } from '@phosphor-icons/react'
import { RecordComparison } from '../../components/RecordComparison'
import { Meter } from '../../components/ui'
import type { CollapseType } from '../../data/posture'
import { historyFor, localDay, type HistoryMode, type Period } from '../../lib/history'
import { summary, type RecordItem } from '../../lib/serviceStore'
import { formatDuration, formatRate } from '../../lib/stats'
import { RecordHistoryItem } from './RecordHistoryItem'

const PERIODS: [Period, string, string][] = [
  ['today', '오늘', '오늘 기록'],
  ['week', '최근 7일', '이번 주 기록'],
  ['month', '최근 30일', '이번 달 기록'],
  ['all', '전체', '전체 기록'],
]

const KIND_LABEL: Record<CollapseType, string> = {
  tilt: '몸이 한쪽으로 기울어짐',
  forwardHead: '머리·상체가 앞으로',
  referenceChange: '그 밖의 기준 변화',
}
const KIND_COLOR: Record<CollapseType, string> = {
  tilt: 'var(--primary)',
  forwardHead: '#e0915f',
  referenceChange: '#ebc3a6',
}
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
  initialPeriod = 'week',
}: {
  records: RecordItem[]
  measuring: boolean
  onStart: () => void
  accountMode?: boolean
  initialPeriod?: Period
}) {
  const [mode, setMode] = useState<HistoryMode>('all')
  const [period, setPeriod] = useState<Period>(initialPeriod)
  const now = new Date()
  const hasDemo = records.some((r) => r.mode === 'demo')
  const selected = historyFor(records, mode, period, now)
  const stats = summary(selected)
  const scoped=selected.some(r=>r.evaluationCounts)
  const alerts = selected.reduce((n, r) => n + r.events.reduce((a, e) => a + e.alerts, 0), 0)
  const days = dayBars(records.filter((r) => mode === 'all' || r.mode === mode), period === 'month' ? 30 : 7, now)
  const kinds = kindShares(selected)
  const kindTotal = kinds.reduce((n, k) => n + k.count, 0)
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

      <div className="view">
        {scoped&&<p className="fine">관측 기준 유지율에는 머리 각도만 평가한 시간이 포함돼요. 몸 전체 자세 유지율이 아닙니다. 각 기록의 상세에서 머리·상체 평가 시간을 구분해 볼 수 있어요.</p>}
        <div className="view-main">
          <div className="records-stats">
            <section className="card" data-stat="rate">
              <div className="stat-label">{scoped?'평균 관측 기준 유지':'평균 바른 자세'}</div>
              <div className="records-stat-value">
                <span className="num">{stats.rate === null ? '—' : Math.round(stats.rate * 100)}</span>
                <small>{stats.rate === null ? '' : '%'}</small>
              </div>
              <p className="records-stat-note">측정한 시간 가운데 기준 자세를 유지한 비율</p>
            </section>
            <section className="card" data-stat="valid">
              <div className="stat-label">측정한 시간</div>
              <div className="records-stat-value">
                <span className="num" style={{ fontSize: 28 }}>
                  {formatDuration(stats.valid)}
                </span>
              </div>
              <p className="records-stat-note">
                측정 <span data-stat="count">{selected.length}</span>회 · 확인 못 한 시간 제외
              </p>
            </section>
            <section className="card" data-stat="alerts">
              <div className="stat-label">받은 알림</div>
              <div className="records-stat-value">
                <span className="num">{alerts}</span>
                <small>회</small>
              </div>
              <p className="records-stat-note">
                {stats.valid > 0 ? `한 시간에 ${formatRate(alerts / (stats.valid / 3600), '회')} 정도` : '측정 후에 계산돼요'}
              </p>
            </section>
          </div>

          <section className="card records-chart" aria-label="날짜별 바른 자세 비율">
            <h3 className="card-title" style={{ marginBottom: 14 }}>
              {scoped?'날짜별 관측 기준 유지율':'날짜별 바른 자세 비율'}
            </h3>
            <div className="bars" style={{ gap: days.length > 7 ? 4 : 12 }}>
              {days.map((d) => (
                <div
                  className={`bar ${d.today ? 'is-today' : ''}`}
                  key={d.key}
                  tabIndex={0}
                  aria-label={`${d.title} ${d.rate === null ? '기록 없음' : `바른 자세 ${Math.round(d.rate * 100)}%`}`}
                >
                  <div className="bar-tip" aria-hidden="true">
                    <div className="combo-tip-title">{d.title}</div>
                    {d.rate === null ? (
                      <div className="combo-tip-row">측정 기록이 없어요</div>
                    ) : (
                      <>
                        <div className="combo-tip-row">
                          <i style={{ background: 'var(--primary)' }} />
                          바른 자세<b>{Math.round(d.rate * 100)}%</b>
                        </div>
                        <div className="combo-tip-row is-detail">
                          측정 시간<b>{formatDuration(d.valid)}</b>
                        </div>
                        <div className="combo-tip-row is-detail">
                          측정 횟수<b>{d.sessions}회</b>
                        </div>
                        <div className="combo-tip-row is-detail">
                          알림<b>{d.alerts}회</b>
                        </div>
                      </>
                    )}
                  </div>
                  {days.length <= 7 && (
                    <span className="bar-value">{d.rate === null ? '—' : `${Math.round(d.rate * 100)}%`}</span>
                  )}
                  <span
                    className={`bar-fill ${d.rate === null ? 'is-empty' : ''}`}
                    style={{ height: `${d.rate === null ? 2 : Math.max(3, d.rate * 82)}%` }}
                  />
                  <span className="bar-label">{days.length <= 7 || d.today || d.date.getDate() % 5 === 0 ? d.label : ' '}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 6 }}>
              측정 기록
            </h3>
            {selected.length === 0 ? (
              <div style={{ padding: '10px 0' }}>
                <p className="fine">선택한 기간에 기록이 없어요. 첫 측정을 마치면 여기에 쌓여요.</p>
                <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={onStart}>
                  <Play size={15} weight="fill" className="icon" />
                  {measuring ? '진행 중인 측정으로' : '측정 시작'}
                </button>
              </div>
            ) : (
              [...selected]
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                .map((record) => <RecordHistoryItem key={record.id} record={record} />)
            )}
          </section>
        </div>
        <div className="view-side">
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>
              자주 흐트러진 방향
            </h3>
            {kinds.length === 0 ? (
              <p className="fine">아직 흐트러진 기록이 없어요.</p>
            ) : (
              <div className="kinds">
                {kindTotal < 5 && (
                  <p className="fine">흐트러진 기록이 {kindTotal}회라 비율은 참고만 해 주세요.</p>
                )}
                {kinds.map((k) => (
                  <div key={k.type}>
                    <div className="kind-head">
                      <span>{KIND_LABEL[k.type]}</span>
                      <span>
                        {k.count}회 · {Math.round(k.share * 100)}%
                      </span>
                    </div>
                    <Meter value={k.share} color={KIND_COLOR[k.type]} />
                  </div>
                ))}
              </div>
            )}
          </section>
          {/* Uses every record of the selected kind, independent of the period above. */}
          <RecordComparison records={records.filter((r) => mode === 'all' || r.mode === mode)} />
          {hasDemo && <p className="fine">합성 시연 결과는 실제 자세 개선 근거가 아니에요.</p>}
        </div>
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
    const dayRecords = records.filter((r) => localDay(r.endedAt) === key)
    const day = summary(dayRecords)
    return {
      key,
      date,
      today: key === todayKey,
      label: count <= 7 ? WEEKDAY[date.getDay()] : String(date.getDate()),
      rate: day.rate,
      valid: day.valid,
      sessions: dayRecords.length,
      alerts: dayRecords.reduce((n, r) => n + r.events.reduce((a, e) => a + e.alerts, 0), 0),
      title: `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY[date.getDay()]})`,
    }
  })
}

function kindShares(records: RecordItem[]) {
  const counts = new Map<CollapseType, number>()
  for (const record of records)
    for (const event of record.events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1)
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  return [...counts]
    .map(([type, n]) => ({ type, count: n, share: n / total }))
    .sort((a, b) => b.share - a.share)
}
