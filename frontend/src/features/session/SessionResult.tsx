import { ArrowCounterClockwise, ChartBar } from '@phosphor-icons/react'
import type { LiveState } from '../../lib/engine'
import { MODEL_VERSION } from '../../data/posture'
import type { CollectionController } from '../../hooks/useCollection'
import { CollectionPanel } from '../../components/CollectionPanel'
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
}: Props) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">측정 종료</h1>
          <p className="page-desc">
            {service
              ? service.saveMessage
              : '이번 측정 결과입니다. 연구 모드 결과는 별도로 보관해 주세요.'}
          </p>
        </div>
        <div className="row">
          <button
            className="btn"
            onClick={() => {
              if (isCamera || service) {
                onPrepare()
                return
              }
              onReset()
            }}
          >
            <ArrowCounterClockwise size={17} weight="bold" className="icon" />
            다시 측정
          </button>
          <button className="btn btn-primary" onClick={onDashboard}>
            <ChartBar size={17} weight="bold" className="icon" />
            대시보드 보기
          </button>
        </div>
      </div>

      {service && (
        <button className="btn" onClick={service.onRetry}>
          저장 다시 시도
        </button>
      )}
      {isCamera && !service && <CollectionPanel collection={collection} />}
      <div className="gap-top">
        <Ledger cols={4}>
          <Stat
            label="유효 측정 시간"
            value={formatDuration(live.validSeconds)}
            sub={`전체 ${formatDuration(live.totalSeconds)}`}
          />
          <Stat
            label="기준 자세 유지율"
            value={formatPercent(keepRate)}
            sub={`기준 유지 ${formatDuration(live.goodSeconds)}`}
            tone={keepRate !== null && keepRate >= 0.75 ? 'good' : undefined}
          />
          <Stat
            label="붕괴 이벤트"
            value={`${live.events.length}건`}
            sub={`알림 ${live.events.reduce((a, e) => a + e.alerts, 0)}회`}
          />
          <Stat label="시간당 붕괴 횟수" value={formatRate(perHour, '회')} />
        </Ledger>
      </div>

      <div className="grid g2 gap-top">
        <Card
          title="붕괴 발생 간격"
          note="같은 세션의 이벤트 시작 간격에서 휴식·판정 불가·관측 공백 시간을 뺍니다. 유효 시간 기준 발생 시각이 없는 과거 기록은 같은 연속 측정 구간만 계산합니다."
        >
          <SampleStat label="평균" value={formatDuration(mean(intervals))} />
          <SampleStat label="중앙값" value={formatDuration(median(intervals))} />
          <SampleStat label="표본 수" value={`${intervals.length}개`} />
        </Card>
        <Card title="회복 시간" note="최초 알림부터 정상 복귀까지 걸린 시간입니다.">
          <SampleStat label="평균" value={formatDuration(mean(recoveries))} />
          <SampleStat label="중앙값" value={formatDuration(median(recoveries))} />
          <SampleStat
            label="표본 수"
            value={`${recoveries.length}개${mutedCount ? ` (알림 꺼짐 ${mutedCount}건 제외)` : ''}`}
          />
        </Card>
      </div>

      <div className="gap-top">
        <Ledger cols={3}>
          <Stat
            label="판정 불가 (집계 제외)"
            value={formatDuration(live.unknownSeconds)}
            sub="자리 비움 · 부분 가림"
            small
          />
          <Stat label="일시정지 (집계 제외)" value={formatDuration(live.pausedSeconds)} small />
          <Stat
            label="모델 버전"
            value={isCamera ? 'reference-rules-v0.1' : MODEL_VERSION}
            sub={isCamera ? '개인 기준 비교 · LSTM 미연결' : '합성 시연 데이터'}
            small
          />
        </Ledger>
      </div>

      <Card title="이벤트 기록" note={`총 ${live.events.length}건`}>
        <EventTable events={live.events} muted={muted} />
      </Card>
    </>
  )
}

function SampleStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="feature-row" style={{ gridTemplateColumns: '1fr auto' }}>
      <span className="feature-name">{label}</span>
      <span className="feature-value">{value}</span>
    </div>
  )
}
