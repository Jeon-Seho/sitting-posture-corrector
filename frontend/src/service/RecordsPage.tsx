import { Card, Ledger, Stat } from '../components/ui'
import { formatDuration, formatPercent } from '../lib/stats'
import { summary, type Mode, type RecordItem } from '../lib/serviceStore'

const day = (iso: string) => new Date(iso).toLocaleDateString('sv-SE')

/** 홈은 오늘, 대시보드는 이 브라우저 전체 기록을 현재 모드 기준으로 집계한다. */
export function RecordsPage({ scope, name, records, mode, measuring, onStart, onReRegister }: {
  scope: 'home' | 'dashboard'
  name: string
  records: RecordItem[]
  mode: Mode
  measuring: boolean
  onStart: () => void
  onReRegister: () => void
}) {
  const today = day(new Date().toISOString())
  const modeRecords = records.filter(r => r.mode === mode)
  const shown = scope === 'home' ? modeRecords.filter(r => day(r.endedAt) === today) : modeRecords
  const stats = summary(shown)
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{scope === 'home' ? `${name}님의 오늘` : '측정 기록'}</h1>
          <p className="page-desc">
            {today} 기준 · {scope === 'home' ? '오늘' : '이 브라우저 전체'} 기록 · {mode === 'camera' ? '실제 웹캠 기록만 집계' : '합성 시연 기록만 집계'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={onStart}>{measuring ? '진행 중인 측정으로' : '측정 시작'}</button>
      </div>
      <Ledger cols={4}>
        <Stat label="기준 자세 유지율" value={formatPercent(stats.rate)} />
        <Stat label="유효 측정 시간" value={formatDuration(stats.valid)} />
        <Stat label="붕괴 사건" value={`${stats.count}건`} />
        <Stat label="측정 기록" value={`${shown.length}회`} />
      </Ledger>
      <Card title="기록별 유지율" note="유효 시간이 없는 기록은 유지율을 계산하지 않습니다.">
        {shown.length === 0
          ? <div className="empty"><h2>아직 측정 기록이 없습니다</h2><p>첫 측정을 마치면 여기에 결과가 쌓입니다.</p></div>
          : shown.map(r => <RecordRow key={r.id} record={r} />)}
      </Card>
      {scope === 'home' && <button className="btn" onClick={onReRegister}>내 기준 자세 다시 등록</button>}
    </>
  )
}

function RecordRow({ record: r }: { record: RecordItem }) {
  const rate = r.valid ? r.good / r.valid : null
  return (
    <div className="service-record">
      <div>
        <strong>{new Date(r.startedAt).toLocaleString()}</strong>
        <span> {r.mode === 'demo' ? '합성 시연' : '실제 웹캠'} · {formatDuration(r.valid)} · {r.events.length}건</span>
      </div>
      <div className="service-bar"><span style={{ width: `${(rate ?? 0) * 100}%` }} /></div>
      <b>{formatPercent(rate)}</b>
    </div>
  )
}
