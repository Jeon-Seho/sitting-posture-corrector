import { ArrowCounterClockwise, ChartBar } from '@phosphor-icons/react'
import type { LiveState } from '../../lib/engine'
import { MODEL_VERSION } from '../../data/posture'
import type { CollectionController } from '../../hooks/useCollection'
import { CollectionPanel } from '../../components/CollectionPanel'
import { Ring } from '../../components/Ring'
import { Card, Ledger, Stat } from '../../components/ui'
import { formatDuration, formatPercent, formatRate, mean, median } from '../../lib/stats'
import { EventTable } from './SessionEvents'
import type { SessionService } from './types'

type Props = {
  service?: SessionService
  isCamera: boolean
  collection: CollectionController
  live: LiveState
  keepRate: number | null
  perHour: number | null
  intervals: number[]
  recoveries: number[]
  mutedCount: number
  muted: Set<number>
  onPrepare: () => void
  onDashboard: () => void
  onReset: () => void
  /** Local camera session: download the would-be Kafka messages. */
  onExport?: () => boolean
  exportCount?: number
}

export function SessionResult({
  service,
  isCamera,
  collection,
  live,
  keepRate,
  perHour,
  intervals,
  recoveries,
  mutedCount,
  muted,
  onPrepare,
  onDashboard,
  onReset,
  onExport,
  exportCount = 0,
}: Props) {
  const alerts = live.events.reduce((a, e) => a + e.alerts, 0)
  const recovery = mean(recoveries)
  return (
    <>
      <section className="result" aria-labelledby="result-title">
        <div className="result-head">
          <Ring value={keepRate} label="바른 자세 비율">
            <span className="ring-value" style={{ fontSize: 34 }}>
              {keepRate === null ? '—' : `${Math.round(keepRate * 100)}%`}
            </span>
            <span className="ring-label">바른 자세</span>
          </Ring>
          <div>
            <div className="result-eyebrow">측정을 마쳤어요</div>
            <h1 className="result-title" id="result-title">
              {live.validSeconds > 0 ? (
                <>
                  {formatDuration(live.validSeconds)} 중 {objectParticle(formatDuration(live.goodSeconds))}
                  <br />
                  바르게 앉아 있었어요
                </>
              ) : (
                '확인된 측정 시간이 없어요'
              )}
            </h1>
            {service && <p className="fine" style={{ marginTop: 8 }}>{service.saveMessage}</p>}
          </div>
        </div>
        <div className="result-tiles">
          <div className="result-tile">
            <span>받은 알림</span>
            <b>{alerts}회</b>
          </div>
          <div className="result-tile">
            <span>바로 앉기까지</span>
            <b>{recovery === null ? '—' : `평균 ${formatDuration(recovery)}`}</b>
          </div>
          <div className="result-tile">
            <span>확인 못 한 시간</span>
            <b>{formatDuration(live.unknownSeconds)}</b>
          </div>
        </div>
        <div className="result-actions">
          {service?.saveFailed ? (
            <button className="btn btn-quiet" onClick={service.onRetry}>
              저장 다시 시도
            </button>
          ) : (
            onExport && (
              <button
                className="btn btn-quiet"
                onClick={onExport}
                title="서버(Kafka)로 보냈어야 할 구간 데이터(txt)와 분석용 관절 좌표(csv)를 내려받아요."
              >
                {exportCount ? `측정 데이터 저장됨 · ${exportCount}구간` : '측정 데이터 저장'}
              </button>
            )
          )}
          <button className="btn" onClick={onDashboard}>
            <ChartBar size={18} weight="bold" className="icon" />
            기록 보기
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (isCamera || service) {
                onPrepare()
                return
              }
              onReset()
            }}
          >
            <ArrowCounterClockwise size={18} weight="bold" className="icon" />
            다시 측정
          </button>
        </div>
      </section>

      {isCamera && !service && <CollectionPanel collection={collection} />}

      <details className="more result-more">
        <summary>자세히 보기 · 사건별 기록과 통계</summary>
        <div className="more-body">
          <Ledger cols={4}>
            <Stat
              label="유효 측정 시간"
              value={formatDuration(live.validSeconds)}
              sub={`전체 ${formatDuration(live.totalSeconds)}`}
              small
            />
            <Stat label="기준 자세 유지율" value={formatPercent(keepRate)} small />
            <Stat
              label="자세 이탈"
              value={`${live.events.length}건`}
              sub={`알림 ${alerts}회`}
              small
            />
            <Stat label="시간당 이탈" value={formatRate(perHour, '회')} small />
          </Ledger>
          <Ledger cols={4}>
            <Stat label="발생 간격 평균" value={formatDuration(mean(intervals))} sub={`중앙값 ${formatDuration(median(intervals))} · ${intervals.length}개`} small />
            <Stat
              label="회복 시간 평균"
              value={formatDuration(recovery)}
              sub={`중앙값 ${formatDuration(median(recoveries))} · ${recoveries.length}개${mutedCount ? ` (알림 꺼짐 ${mutedCount}건 제외)` : ''}`}
              small
            />
            <Stat label="쉰 시간 (집계 제외)" value={formatDuration(live.pausedSeconds)} small />
            <Stat
              label="판정 방식"
              value={isCamera ? 'reference-rules-v0.1' : MODEL_VERSION}
              sub={isCamera ? '개인 기준 비교' : '합성 시연 데이터'}
              small
            />
          </Ledger>
          <Card title="사건 기록" note={`총 ${live.events.length}건`}>
            <EventTable events={live.events} muted={muted} />
          </Card>
        </div>
      </details>
    </>
  )
}

/** '3분을' / '40초를': pick the object particle from the last syllable. */
function objectParticle(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  const batchim = code >= 0 && code <= 11171 && code % 28 !== 0
  return `${word}${batchim ? '을' : '를'}`
}
