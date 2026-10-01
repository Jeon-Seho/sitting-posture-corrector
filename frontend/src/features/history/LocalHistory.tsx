import { useState } from 'react'
import { Card, Ledger, Stat } from '../../components/ui'
import { RecordComparison } from '../../components/RecordComparison'
import {
  dailyHistory,
  historyFor,
  localDay,
  type HistoryMode,
  type Period,
} from '../../lib/history'
import { summary, type RecordItem } from '../../lib/serviceStore'
import { formatDuration, formatPercent } from '../../lib/stats'
import { RecordHistoryItem } from './RecordHistoryItem'

export function LocalHistory({
  page,
  name,
  records,
  measuring,
  onStart,
  onRegister,
  accountMode = false,
}: {
  page: 'home' | 'dashboard'
  name: string
  records: RecordItem[]
  measuring: boolean
  onStart: () => void
  onRegister: () => void
  accountMode?: boolean
}) {
  const [selectedMode, setSelectedMode] = useState<HistoryMode>('all')
  const [period, setPeriod] = useState<Period>('week')
  const now = new Date(),
    today = localDay(now.toISOString())
  const selected = historyFor(records, selectedMode, page === 'home' ? 'today' : period, now)
  const stats = summary(selected),
    days = dailyHistory(selected)
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{page === 'home' ? `${name}님의 오늘` : '측정 기록'}</h1>
          <p className="page-desc">
            {today} 조회 기준 ·{' '}
            {selectedMode === 'all'
              ? '실제 웹캠·합성 시연 합산'
              : selectedMode === 'camera'
                ? '실제 웹캠 기록'
                : '합성 시연 기록'}{' '}
            · {accountMode ? '내 계정에 저장된 요약' : '이 브라우저의 로컬 요약'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={onStart}>
          {measuring ? '진행 중인 측정으로' : '측정 시작'}
        </button>
      </div>
      <div className="row" role="group" aria-label="기록 종류">
        <button
          className="chip"
          aria-pressed={selectedMode === 'all'}
          onClick={() => setSelectedMode('all')}
        >
          모든 기록
        </button>
        <button
          className="chip"
          aria-pressed={selectedMode === 'camera'}
          onClick={() => setSelectedMode('camera')}
        >
          실제 웹캠 기록
        </button>
        <button
          className="chip"
          aria-pressed={selectedMode === 'demo'}
          onClick={() => setSelectedMode('demo')}
        >
          합성 시연 기록
        </button>
      </div>
      {page === 'dashboard' && (
        <div className="row gap-top" role="group" aria-label="기록 조회 기간">
          {(
            [
              ['today', '오늘'],
              ['week', '최근 7일'],
              ['month', '최근 30일'],
              ['all', '전체'],
            ] as const
          ).map(([id, label]) => (
            <button
              className="chip"
              key={id}
              aria-pressed={period === id}
              onClick={() => setPeriod(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="gap-top">
        <Ledger cols={4}>
          <Stat label="기준 자세 유지율" value={formatPercent(stats.rate)} />
          <Stat label="유효 측정 시간" value={formatDuration(stats.valid)} />
          <Stat label="이탈 사건" value={`${stats.count}건`} />
          <Stat label="측정 기록" value={`${selected.length}회`} />
        </Ledger>
      </div>
      {page === 'dashboard' && days.length > 0 && (
        <Card
          title="날짜별 유지율"
          note="기록이 있는 날짜만 표시하며, 각 날짜의 유효 시간으로 가중 집계합니다."
        >
          {days.map((d) => (
            <div className="service-record" key={d.date}>
              <div>
                <strong>{d.date}</strong>
                <span>
                  {' '}
                  {d.sessions}회 · {formatDuration(d.valid)} · {d.count}건
                </span>
              </div>
              <div className="service-bar">
                <span style={{ width: `${(d.rate ?? 0) * 100}%` }} />
              </div>
              <b>{formatPercent(d.rate)}</b>
            </div>
          ))}
        </Card>
      )}
      <Card
        title="기록별 유지율"
        note="세션 종료일·브라우저 시간대 기준입니다. 자정을 지난 세션은 아직 날짜별로 나누지 않습니다. 유효 시간 0은 계산 불가입니다."
      >
        {selected.length === 0 ? (
          <div className="empty">
            <h2>아직 측정 기록이 없습니다</h2>
            <p>선택한 종류와 기간에 기록이 없습니다. 첫 측정을 마치면 여기에 결과가 쌓입니다.</p>
          </div>
        ) : (
          selected.map((record) => <RecordHistoryItem key={record.id} record={record} />)
        )}
      </Card>
      {page === 'home' && (
        <button className="btn" onClick={onRegister}>
          내 기준 자세 다시 등록
        </button>
      )}
      {page === 'dashboard' && (
        <>
          <p className="fine gap-top">
            처음과 최근 비교는 위 조회 기간과 별도로, 선택한 기록 종류의 전체 기록을 사용합니다.
            합성 시연 결과는 실제 자세 개선 근거가 아닙니다.
          </p>
          <RecordComparison
            records={records.filter((r) => selectedMode === 'all' || r.mode === selectedMode)}
          />
        </>
      )}
    </>
  )
}
