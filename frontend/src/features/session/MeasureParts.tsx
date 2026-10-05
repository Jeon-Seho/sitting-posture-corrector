import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowsClockwise, BellSlash, Hourglass, Person, Question } from '@phosphor-icons/react'
import { Ring } from '../../components/Ring'
import { Meter } from '../../components/ui'
import { formatClock, formatDuration, formatPercent } from '../../lib/stats'
import {
  correctionHint,
  statusCopy,
  timelineKind,
  type LiveView,
  type TimelineKind,
} from './liveView'

export function StatusPill({ view }: { view: LiveView }) {
  const copy = statusCopy(view)
  return (
    <span className={`pill ${copy.tone}`} role="status" aria-live="polite">
      <span className="dot" />
      {copy.pill}
    </span>
  )
}

export function ClockPill({ seconds, running }: { seconds: number; running: boolean }) {
  return (
    <span className="pill small">
      {running && <span className="rec-dot" />}
      <span className="num">{formatClock(seconds)}</span>
    </span>
  )
}

/** Score ring + one friendly sentence. */
export function ScoreCard({ view, warningScore }: { view: LiveView; warningScore: number }) {
  const copy = statusCopy(view)
  const color =
    view.score === null
      ? 'var(--unknown)'
      : view.score <= warningScore
        ? 'var(--alert)'
        : 'var(--good)'
  return (
    <section className="card score-card" aria-label="자세 점수">
      <Ring value={view.score === null ? null : view.score / 100} color={color}>
        <span className="ring-value" style={{ fontSize: 40 }}>
          {view.score === null ? '—' : Math.round(view.score)}
        </span>
        <span className="ring-label">자세 점수</span>
      </Ring>
      <div>
        <div className="score-title">
          {view.score === null
            ? copy.title
            : view.score <= warningScore
              ? '기준과 달라요'
              : '기준과 비슷해요'}
        </div>
        <p className="score-desc">
          100에 가까울수록 처음 등록한 자세와 비슷해요. 의학적 점수는 아니에요.
        </p>
      </div>
    </section>
  )
}

export function SessionSummaryCard({ view, title = '이번 측정' }: { view: LiveView; title?: string }) {
  return (
    <section className="card">
      <h3 className="card-title" style={{ marginBottom: 14 }}>
        {title}
      </h3>
      <div className="kv">
        바른 자세 유지<b>{formatPercent(view.keepRate, 0)}</b>
      </div>
      <div className="kv">
        측정한 시간<b>{formatDuration(view.validSeconds)}</b>
      </div>
      <div className="kv">
        알림<b>{view.alerts}회</b>
      </div>
      {view.unknownSeconds > 0 && (
        <div className="kv">
          확인 못 한 시간<b>{formatDuration(view.unknownSeconds)}</b>
        </div>
      )}
    </section>
  )
}

/** Correction / status card shown over the camera. */
export function Nudge({
  view,
  alertsOn,
  holdSeconds,
  recoverSeconds,
}: {
  view: LiveView
  alertsOn: boolean
  holdSeconds: number
  recoverSeconds: number
}) {
  if (view.status === 'unmeasurable' || view.status === 'analysisPaused') {
    return (
      <Card icon={<Question size={24} weight="bold" />} tone="quiet" title={statusCopy(view).title}>
        {view.notice ?? '얼굴과 양쪽 어깨가 보이게 앉아 주세요.'} 이 시간은 기록에서 빠져요.
      </Card>
    )
  }
  if (view.status === 'suspect') {
    return (
      <Card
        icon={<Hourglass size={24} weight="bold" />}
        tone="wait"
        title="자세가 조금 달라졌어요"
        progress={view.holdProgress}
      >
        {holdSeconds}초 넘게 이어지면 알려드릴게요.
      </Card>
    )
  }
  if (view.status !== 'bad' && view.status !== 'recovering') return null
  if (!alertsOn) {
    return (
      <Card icon={<BellSlash size={24} weight="bold" />} tone="quiet" title="알림이 꺼져 있어요">
        흐트러진 자세는 계속 기록하지만 알려드리지는 않아요.
      </Card>
    )
  }
  return (
    <Card
      icon={view.status === 'recovering' ? <ArrowsClockwise size={24} weight="bold" /> : <Person size={24} weight="bold" />}
      title={view.status === 'recovering' ? '좋아요, 그대로 있어 주세요' : correctionHint(view)}
      progress={view.recoverProgress}
    >
      바르게 앉으면 {recoverSeconds}초 뒤에 알림이 사라져요
      {view.nextAlertIn !== null && view.status === 'bad'
        ? ` · 다시 알림까지 ${Math.ceil(view.nextAlertIn)}초`
        : ''}
    </Card>
  )
}

function Card({
  icon,
  title,
  children,
  tone = '',
  progress,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  tone?: '' | 'quiet' | 'wait'
  progress?: number
}) {
  return (
    <div className={`nudge ${tone}`}>
      <div className="nudge-icon">{icon}</div>
      <div className="nudge-body">
        <div className="nudge-title">{title}</div>
        <div className="nudge-desc">{children}</div>
        {progress !== undefined && <Meter value={progress} />}
      </div>
    </div>
  )
}

const TIMELINE_WINDOW = 30 * 60
const SAMPLE_SECONDS = 5

/**
 * Keeps a coarse 30-minute strip of what happened, sampled from the screen state.
 * It is a display aid only; saved records keep the engine's own totals.
 */
export function useStatusTimeline(view: LiveView) {
  const kind = useRef<TimelineKind>(timelineKind(view.status))
  kind.current = timelineKind(view.status)
  const [samples, setSamples] = useState<TimelineKind[]>([])
  useEffect(() => {
    const timer = setInterval(() => {
      setSamples((old) => [...old, kind.current].slice(-TIMELINE_WINDOW / SAMPLE_SECONDS))
    }, SAMPLE_SECONDS * 1000)
    return () => clearInterval(timer)
  }, [])
  const runs: { kind: TimelineKind; count: number }[] = []
  for (const sample of samples) {
    const last = runs[runs.length - 1]
    if (last?.kind === sample) last.count++
    else runs.push({ kind: sample, count: 1 })
  }
  return runs
}

export function TimelineCard({ runs }: { runs: { kind: TimelineKind; count: number }[] }) {
  return (
    <section className="card panel-fill">
      <h3 className="card-title" style={{ marginBottom: 14 }}>
        최근 30분
      </h3>
      <div className="timeline" role="img" aria-label="최근 30분 자세 흐름">
        {runs.map((run, i) => (
          <span key={i} className={run.kind} style={{ flex: run.count }} />
        ))}
      </div>
      <TimelineLegend />
      {runs.length === 0 && <p className="fine" style={{ marginTop: 10 }}>측정하면서 흐름이 채워져요.</p>}
    </section>
  )
}

export function TimelineLegend() {
  return (
    <div className="timeline-legend">
      <span>
        <i style={{ background: 'var(--good-soft)' }} />
        바른 자세
      </span>
      <span>
        <i style={{ background: 'var(--alert-soft)' }} />
        자세 흐트러짐
      </span>
      <span>
        <i style={{ background: 'var(--unknown-soft)' }} />
        확인 못 함
      </span>
    </div>
  )
}
