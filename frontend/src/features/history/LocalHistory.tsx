import { useEffect, useState } from 'react'
import { RecordComparison } from '../../components/RecordComparison'
import { Card } from '../../components/ui'
import type { HistoryMode } from '../../lib/history'
import type { RecordItem } from '../../lib/serviceStore'
import { ActivityHeatmap, HEATMAP_WEEKS } from './ActivityHeatmap'
import { DayRecord } from './DayRecord'
import { RecordCalendar } from './RecordCalendar'
import { addDays, dailyStats, dayKey } from './recordsSource'

/**
 * Records tab (2026-10-13 redesign). A long history no longer piles up on one page:
 * 1. 측정한 날 — contribution-style heatmap of the last 13 weeks (darker = measured longer).
 * 2. 오늘의 기록 — today by default, or the day picked in the heatmap or calendar.
 * 3. 기간별 기록 — 최근 7일 · 최근 30일 charts and a month calendar.
 * 4. 처음과 최근 비교 — folded.
 * The numbers come from recordsSource.ts, shaped like `GET /records?date` and
 * `GET /stats/daily` (docs/design/api-ws-spec.md), so the server can take over without
 * changing this screen.
 */
export function LocalHistory({
  records: allRecords,
  measuring,
  onStart,
  todayRequest = 0,
}: {
  records: RecordItem[]
  /** Changes each time the sidebar's today card is pressed: show today's record. */
  todayRequest?: number
  measuring: boolean
  onStart: () => void
}) {
  const today = dayKey(new Date())
  const [mode, setMode] = useState<HistoryMode>('all')
  const [selected, setSelected] = useState(today)
  useEffect(() => {
    if (todayRequest) setSelected(today)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayRequest])
  const hasDemo = allRecords.some((r) => r.mode === 'demo')
  const records = allRecords.filter((r) => mode === 'all' || r.mode === mode)
  // Heatmap and calendar months need more than 13 weeks; the calendar may go further back.
  const stats = dailyStats(records, addDays(today, -400), today)

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">기록</h1>
          <p className="page-desc">
            {hasDemo &&
              `${mode === 'all' ? '실제 웹캠·합성 시연 합산' : mode === 'camera' ? '실제 웹캠 기록' : '합성 시연 기록'} · `}
            이 기기에 저장된 기록
          </p>
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
        <Card title="측정한 날" note={`최근 ${HEATMAP_WEEKS}주 · 진할수록 오래 측정했어요`}>
          <ActivityHeatmap stats={stats} today={today} selected={selected} onSelect={setSelected} />
        </Card>

        <DayRecord
          records={records}
          day={selected}
          today={today}
          measuring={measuring}
          onStart={onStart}
          onToday={() => setSelected(today)}
        />

        <RecordCalendar stats={stats} today={today} selected={selected} onSelect={setSelected} />

        <details className="more">
          <summary>처음과 최근 비교</summary>
          <div className="more-body">
            <p className="fine">
              선택한 기록 종류의 전체 기록을 사용합니다. 합성 시연 결과는 실제 자세 개선 근거가 아닙니다.
            </p>
            <RecordComparison records={records} />
          </div>
        </details>
      </div>
    </>
  )
}
