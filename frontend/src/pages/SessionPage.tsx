import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowCounterClockwise,
  BellSlash,
  ChartBar,
  FastForward,
  House,
  Pause,
  Play,
  Question,
  Stop,
  WarningOctagon,
} from '@phosphor-icons/react'
import {
  COLLAPSE_LABEL,
  DEFAULT_RULES,
  MODEL_VERSION,
  STATE_LABEL,
} from '../data/posture'
import { useSession, type CollapseEvent, type SessionPhase } from '../hooks/useSession'
import type { CollectionController } from '../hooks/useCollection'
import { postureScore } from '../lib/postureScore'
import { VisualControls } from '../components/VisualControls'
import { cameraSample } from '../lib/cameraSample'
import type { CameraController } from '../hooks/useCamera'
import { CollectionPanel } from '../components/CollectionPanel'
import { CameraStage } from '../components/CameraStage'
import { PoseStage } from '../components/PoseStage'
import { Card, FeatureRow, Ledger, Meter, Rate, Stat } from '../components/ui'
import {
  formatClock,
  formatDuration,
  formatPercent,
  formatRate,
  mean,
  median,
  ratio,
} from '../lib/stats'

const SPEEDS = [1, 2, 4, 8]

export function SessionPage({
  rules,
  alertsOn,
  onFinish,
  onDashboard,
  onPrepare,
  camera,
  mode,
  collection,
}: {
  collection: CollectionController
  rules: typeof DEFAULT_RULES
  alertsOn: boolean
  onFinish: () => void
  onDashboard: () => void
  onPrepare: () => void
  camera: CameraController
  mode: 'camera' | 'demo'
}) {
  const [phase, setPhase] = useState<SessionPhase>('running')
  const [speed, setSpeed] = useState(4)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const isCamera = mode === 'camera'
  const { live, reset, seekNext } = useSession(phase, speed, rules, isCamera ? () => cameraSample(camera) : undefined, alertsOn)
  const current = camera.current.current
  const baseline = camera.baseline
  useEffect(() => { collection.setPhase(isCamera ? phase : 'inactive') }, [phase, isCamera, collection.setPhase])
  useEffect(() => () => collection.setPhase('inactive'), [collection.setPhase])
  useEffect(() => { if (phase === 'ended' && isCamera) camera.stop() }, [phase])
  useEffect(() => {
    const hidden = () => { if (document.hidden) setPhase(p => p === 'running' ? 'paused' : p) }
    document.addEventListener('visibilitychange', hidden)
    return () => document.removeEventListener('visibilitychange', hidden)
  }, [])

  const muted = useMemo(() => new Set(live.events.filter(e => e.alerts === 0).map(e => e.id)), [live.events])

  // 알림이 울린 순간에만 토스트를 띄운다
  const [toast, setToast] = useState<string | null>(null)
  const lastTick = useRef(0)
  useEffect(() => {
    if (live.alertTick === lastTick.current) return
    lastTick.current = live.alertTick
    if (!alertsOn || phase !== 'running' || live.state === 'unknown') return
    setToast(
      live.collapse
        ? `${COLLAPSE_LABEL[live.collapse]} 상태가 ${rules.holdSeconds}초 이상 이어졌습니다.`
        : '자세 붕괴가 감지되었습니다.',
    )
    const t = setTimeout(() => setToast(null), 3600)
    return () => clearTimeout(t)
  }, [live.alertTick])
  useEffect(() => { if (phase !== 'running' || live.state === 'unknown' || !alertsOn) setToast(null) }, [phase, live.state, alertsOn])

  const keepRate = ratio(live.goodSeconds, live.validSeconds)
  const perHour = live.validSeconds > 0 ? live.events.length / (live.validSeconds / 3600) : null
  const displayScore = postureScore(live.state === 'unknown' || phase === 'paused' ? null : live.collapseProb)
  const warningScore = postureScore(rules.threshold)!
  const overThreshold = live.collapseProb >= rules.threshold

  const { intervals, recoveries, mutedCount } = useMemo(() => {
    const starts = [...live.events].sort((a, b) => a.startAt - b.startAt)
    const gaps = starts.slice(1).flatMap((event, i) => event.blockId === starts[i].blockId ? [event.startAt - starts[i].startAt] : [])
    const rec = live.events.filter(
      (e) => e.recovered && e.recoverySec !== null && !muted.has(e.id),
    )
    return {
      intervals: gaps,
      recoveries: rec.map((e) => e.recoverySec as number),
      mutedCount: live.events.filter((e) => muted.has(e.id)).length,
    }
  }, [live.events])

  if (phase === 'ended') {
    return (
      <>
        <div className="page-head">
          <div>
            <h1 className="page-title">측정 종료</h1>
            <p className="page-desc">
              이번 측정 결과입니다. 화면을 떠나면 사라지며, 대시보드에는 예시 기록이 표시됩니다.
            </p>
          </div>
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                if (isCamera) { onPrepare(); return }
                lastTick.current = 0
                reset()
                setPhase('running')
              }}
            >
              <ArrowCounterClockwise size={17} weight="bold" className="icon" />
              다시 측정
            </button>
            <button className="btn btn-primary" onClick={onDashboard}>
              <ChartBar size={17} weight="bold" className="icon" />
              예시 대시보드 보기
            </button>
          </div>
        </div>

        {isCamera && <CollectionPanel collection={collection} />}
        <div className="gap-top">
          <Ledger cols={4}>
            <Stat
              label="유효 측정 시간"
              value={formatDuration(live.validSeconds)}
              sub={`전체 ${formatDuration(live.totalSeconds)}`}
            />
            <Stat
              label="바른 자세 유지율"
              value={formatPercent(keepRate)}
              sub={`바른 자세 ${formatDuration(live.goodSeconds)}`}
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
          <Card title="붕괴 발생 간격" note="같은 연속 측정 구간의 이벤트 시작 간격입니다. 휴식·판정 불가 전후는 연결하지 않습니다.">
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
            <Stat label="모델 버전" value={isCamera ? 'reference-rules-v0.1' : MODEL_VERSION} sub={isCamera ? '개인 기준 비교 · LSTM 미연결' : '합성 시연 데이터'} small />
          </Ledger>
        </div>

        <Card title="이벤트 기록" note={`총 ${live.events.length}건`}>
          <EventTable events={live.events} muted={muted} />
        </Card>
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">실시간 측정</h1>
          <p className="page-desc">
            자세 점수가 {warningScore}점 이하로 {rules.holdSeconds}초 이상
            이어질 때만 이벤트로 확정합니다.
          </p>
        </div>
        {!isCamera && <div className="row" role="group" aria-label="시연 배속">
          <span className="stat-label">시연 배속</span>
          <div className="segmented">
            {SPEEDS.map((s) => (
              <button
                key={s}
                className="chip num"
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>}
      </div>

      <div className="session-grid">
        <div className="stack">
          <div className="stage">
            {isCamera ? <CameraStage camera={camera} showSkeleton={showSkeleton} /> : <PoseStage
              keypoints={live.keypoints}
              state={live.state}
              confidence={live.confidence}
              showSkeleton={showSkeleton}
            />}
            <div className="stage-overlay">
              <div className="stage-top">
                <span className="stage-tag">
                  {phase === 'running' ? <i className="rec-dot" /> : <Pause size={13} weight="fill" />}
                  {phase === 'running' ? isCamera ? '웹캠 측정 중' : '합성 시연 중' : '일시정지'}
                  <span className="num muted">{formatClock(live.totalSeconds)}</span>
                </span>
                <span className="stage-tag">
                  {isCamera && <span>{camera.metrics.fps.toFixed(0)} FPS · {camera.metrics.inferenceMs.toFixed(0)}ms · {camera.metrics.delegate}</span>}
                  <span className="muted">검출 신뢰도</span>
                  <b className="num">{(live.confidence * 100).toFixed(0)}%</b>
                </span>
              </div>

              <div className="stage-bottom" aria-live="polite">
                {phase === 'running' && live.state === 'collapse' && !live.alerting && (
                  <div className="hold-bar">
                    <div className="label">
                      <span>
                        붕괴 지속 확인 중 · {live.collapse ? COLLAPSE_LABEL[live.collapse] : ''}
                      </span>
                      <span className="num">
                        {(live.holdProgress * rules.holdSeconds).toFixed(1)} /{' '}
                        {rules.holdSeconds.toFixed(1)}초
                      </span>
                    </div>
                    <Meter value={live.holdProgress} color="var(--warn-hi)" />
                  </div>
                )}

                {phase === 'running' && live.state === 'unknown' && (
                  <div className="alert-banner notice">
                    <Question size={22} weight="bold" className="icon alert-icon gray" />
                    <div>
                      <div className="alert-title">판정 불가 구간</div>
                      <div className="alert-desc">
                        {live.notice} 이 구간은 유효 측정 시간에서 제외됩니다.
                      </div>
                    </div>
                  </div>
                )}

                {phase === 'running' && live.state !== 'unknown' && live.alerting && alertsOn && (
                  <div className="alert-banner">
                    <WarningOctagon size={22} weight="fill" className="icon alert-icon" />
                    <div style={{ flex: 1 }}>
                      <div className="alert-title">
                        자세를 교정해 주세요
                        {live.collapse ? ` · ${COLLAPSE_LABEL[live.collapse]}` : ''}
                      </div>
                      <div className="alert-desc">
                        등록한 기준에서 자세 변화가 이어지고 있어요. 편안하게 앉아 자세를 확인해 주세요.
                      </div>
                      <div className="event-meta" style={{ marginTop: 6 }}>
                        <span>
                          복귀 확인 {(live.recoverProgress * rules.recoverSeconds).toFixed(1)}/
                          {rules.recoverSeconds}초
                        </span>
                        {live.nextAlertIn !== null && (
                          <span>재알림까지 {Math.ceil(live.nextAlertIn)}초</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {phase === 'running' && live.state !== 'unknown' && live.alerting && !alertsOn && (
                  <div className="alert-banner notice">
                    <BellSlash size={22} weight="bold" className="icon alert-icon gray" />
                    <div>
                      <div className="alert-title">알림이 꺼져 있습니다</div>
                      <div className="alert-desc">
                        붕괴 이벤트는 계속 기록되지만 알림은 표시하지 않습니다.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="controls">
            <div className="row">
              <button
                className="btn"
                onClick={() => setPhase(phase === 'paused' ? 'running' : 'paused')}
              >
                {phase === 'paused' ? (
                  <Play size={17} weight="fill" className="icon" />
                ) : (
                  <Pause size={17} weight="fill" className="icon" />
                )}
                {phase === 'paused' ? '측정 재개' : '일시정지'}
              </button>
              <button className="btn btn-danger" onClick={() => setPhase('ended')}>
                <Stop size={17} weight="fill" className="icon" />
                측정 종료
              </button>
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button
                className="chip"
                aria-pressed={showSkeleton}
                onClick={() => setShowSkeleton(!showSkeleton)}
              >
                키포인트 표시
              </button>
              {!isCamera && <button className="btn btn-sm" onClick={seekNext}>
                <FastForward size={15} weight="fill" className="icon" />
                다음 구간으로
              </button>}
              <button className="btn btn-sm" onClick={onFinish}>
                <House size={15} weight="bold" className="icon" />
                홈으로
              </button>
            </div>
          </div>
          {isCamera && <VisualControls camera={camera} />}
          {isCamera && <CollectionPanel collection={collection} />}
        </div>

        <div className="stack">
          <Card title="현재 판정" dark>
            <div className="verdict" aria-live="polite">
              <span key={`${live.state}-${live.collapse ?? ''}`} className={`verdict-word ${live.state}`}>
                {phase === 'paused' ? '휴식 중' : live.state === 'collapse' && live.collapse
                  ? COLLAPSE_LABEL[live.collapse] : STATE_LABEL[live.state]}
              </span>
              <span className="verdict-sub">{phase === 'paused' ? '휴식 시간은 집계에서 제외합니다' : `${STATE_LABEL[live.state]} · ${isCamera ? '규칙 기반 판정' : '합성 시연'}`}</span>
            </div>

            <div className="prob">
              <span className="rate-label" style={{ color: 'var(--panel-muted)' }}>
                {isCamera ? '자세 점수' : '자세 점수 · 시연'}
              </span>
              <span className={`figure ${overThreshold ? 'over' : ''}`}>
                {displayScore === null ? '—' : `${displayScore.toFixed(1)}점`}
              </span>
            </div>
            <Meter
              value={(displayScore ?? 0) / 100}
              color={displayScore === null ? 'var(--muted)' : overThreshold ? 'var(--accent)' : 'var(--good-fill)'}
            />
            <p className="card-note" style={{ marginTop: 8 }}>
              100점에 가까울수록 기준 자세와 비슷합니다. {warningScore}점 이하가 {rules.holdSeconds}초 이어지면 알립니다. {isCamera ? '의학적 점수나 정확도가 아닙니다.' : '합성 시연 점수입니다.'}
            </p>

            <div className="divider" />
            <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
              <Rate value={keepRate} label="유지율" />
              <div style={{ flex: 1 }}>
                <MiniRow label="유효 측정" value={formatDuration(live.validSeconds)} />
                <MiniRow label="바른 자세" value={formatDuration(live.goodSeconds)} />
                <MiniRow label="판정 불가" value={formatDuration(live.unknownSeconds)} />
                <MiniRow label="붕괴 이벤트" value={`${live.events.length}건`} />
              </div>
            </div>
          </Card>

          {isCamera ? <Card title="기준 대비 특징 변화" note="어깨 너비로 나눈 무단위 차이입니다. 실제 관절 각도가 아닙니다.">
            <MiniRow label="머리 높이 변화" value={current && baseline && live.state !== 'unknown' ? Math.abs(current.headGap - baseline.headGap).toFixed(3) : '—'} />
            <MiniRow label="좌우 치우침 변화" value={current && baseline && live.state !== 'unknown' ? Math.abs(current.offset - baseline.offset).toFixed(3) : '—'} />
            <MiniRow label="어깨 기울기 변화" value={current && baseline && live.state !== 'unknown' ? Math.abs(current.tilt - baseline.tilt).toFixed(3) : '—'} />
          </Card> : <>
          <Card title="자세 특징값" note="아래 각도와 비율은 발표용 합성 수치입니다.">
            <FeatureRow
              name="목 전방 이동"
              value={live.features.neckForward}
              unit="°"
              ratio={live.features.neckForward / 40}
              color={live.features.neckForward > 25 ? 'var(--bad-fill)' : 'var(--good-fill)'}
            />
            <FeatureRow
              name="어깨 기울기"
              value={live.features.shoulderTilt}
              unit="°"
              ratio={live.features.shoulderTilt / 15}
              color={live.features.shoulderTilt > 8 ? 'var(--bad-fill)' : 'var(--good-fill)'}
            />
            <FeatureRow
              name="상체 기울기"
              value={live.features.trunkTilt}
              unit="°"
              ratio={live.features.trunkTilt / 20}
              color={live.features.trunkTilt > 12 ? 'var(--bad-fill)' : 'var(--good-fill)'}
            />
            <FeatureRow
              name="좌우 균형"
              value={live.features.lateralBalance}
              unit="%"
              ratio={live.features.lateralBalance / 100}
              color={live.features.lateralBalance < 80 ? 'var(--bad-fill)' : 'var(--good-fill)'}
            />
          </Card>

          </>}

          <Card title="붕괴 이벤트" note={`${live.events.length}건 기록됨`}>
            {live.events.length === 0 ? (
              <p className="muted" style={{ fontSize: 14 }}>
                아직 확정된 이벤트가 없습니다. 붕괴가 {rules.holdSeconds}초 이상 이어지면 여기에
                기록됩니다.
              </p>
            ) : (
              <div className="list">
                {live.events.map((e) => (
                  <EventItem key={e.id} event={e} muted={muted.has(e.id)} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {toast && phase === 'running' && live.state !== 'unknown' && alertsOn && (
        <div className="toast" role="status">
          <WarningOctagon size={22} weight="fill" className="icon" />
          <div>
            <div className="alert-title">자세 교정 알림</div>
            <div className="alert-desc">{toast}</div>
          </div>
        </div>
      )}
    </>
  )
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="feature-row" style={{ gridTemplateColumns: '1fr auto', padding: '6px 0' }}>
      <span className="feature-name">{label}</span>
      <span className="feature-value">{value}</span>
    </div>
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

function EventItem({ event: e, muted }: { event: CollapseEvent; muted: boolean }) {
  return (
    <div className="event-item">
      <div className="top">
        <span>
          <span className="figure">#{e.id}</span>
          {COLLAPSE_LABEL[e.type]}
        </span>
        {e.endAt === null ? (
          <span className="badge collapse">
            <i className="pip" />
            진행 중
          </span>
        ) : e.endReason ? (
          <span className="badge unknown">
            <i className="pip" />
            {e.endReason === 'paused' ? '휴식으로 중단' : e.endReason === 'unknown' ? '측정 불가로 중단' : '세션 종료로 중단'}
          </span>
        ) : (
          <span className="badge good">
            <i className="pip" />
            복귀
          </span>
        )}
      </div>
      <div className="event-meta">
        <span>시작 {formatClock(e.startAt)}</span>
        <span>지속 {e.endAt === null ? '—' : formatDuration(e.durationSec)}</span>
        <span>알림 {e.alerts}회</span>
        <span>회복 {e.recoverySec === null ? '—' : formatDuration(e.recoverySec)}</span>
        {muted && <span className="warn">알림 꺼짐</span>}
      </div>
    </div>
  )
}

function EventTable({ events, muted }: { events: CollapseEvent[]; muted: Set<number> }) {
  if (events.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 14 }}>
        기록된 이벤트가 없습니다.
      </p>
    )
  }
  return (
    <div className="scroll-x">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>유형</th>
            <th>시작</th>
            <th>종료</th>
            <th className="t-right">지속</th>
            <th className="t-right">알림</th>
            <th className="t-right">회복 시간</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {[...events]
            .sort((a, b) => a.id - b.id)
            .map((e) => (
              <tr key={e.id}>
                <td>{e.id}</td>
                <td>{COLLAPSE_LABEL[e.type]}</td>
                <td>{formatClock(e.startAt)}</td>
                <td>{e.endAt === null ? '—' : formatClock(e.endAt)}</td>
                <td className="t-right">
                  {e.endAt === null ? '—' : formatDuration(e.durationSec)}
                </td>
                <td className="t-right">{e.alerts}회</td>
                <td className="t-right">
                  {e.recoverySec === null ? '—' : formatDuration(e.recoverySec)}
                </td>
                <td>
                  {e.endReason
                    ? e.endReason === 'paused' ? '휴식으로 중단' : e.endReason === 'unknown' ? '측정 불가로 중단' : '세션 종료로 중단'
                    : e.recovered
                      ? muted.has(e.id)
                        ? '복귀 (알림 꺼짐)'
                        : '복귀'
                      : '진행 중'}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}
