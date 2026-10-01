import type { CameraController } from '../../hooks/useCamera'
import { COLLAPSE_LABEL, STATE_LABEL } from '../../data/posture'
import { Card, FeatureRow, Meter, Rate } from '../../components/ui'
import { formatDuration } from '../../lib/stats'
import { EventItem } from './SessionEvents'
import type { SessionScreen } from './useSessionScreen'

export function SessionVerdict({
  screen,
  camera,
}: {
  screen: SessionScreen
  camera: CameraController
}) {
  const {
    rules,
    phase,
    isCamera,
    live,
    muted,
    keepRate,
    displayScore,
    warningScore,
    overThreshold,
  } = screen
  const current = camera.current.current
  const baseline = camera.baseline
  return (
    <div className="stack">
      <Card title="현재 판정" dark>
        <div className="verdict" aria-live="polite">
          <span
            key={`${live.state}-${live.collapse ?? ''}`}
            className={`verdict-word ${live.state}`}
          >
            {phase === 'paused'
              ? '휴식 중'
              : live.state === 'collapse' && live.collapse
                ? COLLAPSE_LABEL[live.collapse]
                : STATE_LABEL[live.state]}
          </span>
          <span className="verdict-sub">
            {phase === 'paused'
              ? '휴식 시간은 집계에서 제외합니다'
              : `${STATE_LABEL[live.state]} · ${isCamera ? '규칙 기반 판정' : '합성 시연'}`}
          </span>
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
          color={
            displayScore === null
              ? 'var(--muted)'
              : overThreshold
                ? 'var(--accent)'
                : 'var(--good-fill)'
          }
        />
        <p className="card-note" style={{ marginTop: 8 }}>
          100점에 가까울수록 기준 자세와 비슷합니다. {warningScore}점 이하가 {rules.holdSeconds}초
          이어지면 알립니다.{' '}
          {isCamera ? '의학적 점수나 정확도가 아닙니다.' : '합성 시연 점수입니다.'}
        </p>

        <div className="divider" />
        <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
          <Rate value={keepRate} label="유지율" />
          <div style={{ flex: 1 }}>
            <MiniRow label="유효 측정" value={formatDuration(live.validSeconds)} />
            <MiniRow label="기준 유지" value={formatDuration(live.goodSeconds)} />
            <MiniRow label="판정 불가" value={formatDuration(live.unknownSeconds)} />
            <MiniRow label="붕괴 이벤트" value={`${live.events.length}건`} />
          </div>
        </div>
      </Card>

      {isCamera ? (
        <Card
          title="기준 대비 특징 변화"
          note="어깨 너비로 나눈 무단위 차이입니다. 실제 관절 각도가 아닙니다."
        >
          <MiniRow
            label="머리 높이 변화"
            value={
              current && baseline && live.state !== 'unknown'
                ? Math.abs(current.headGap - baseline.headGap).toFixed(3)
                : '—'
            }
          />
          <MiniRow
            label="좌우 치우침 변화"
            value={
              current && baseline && live.state !== 'unknown'
                ? Math.abs(current.offset - baseline.offset).toFixed(3)
                : '—'
            }
          />
          <MiniRow
            label="어깨 기울기 변화"
            value={
              current && baseline && live.state !== 'unknown'
                ? Math.abs(current.tilt - baseline.tilt).toFixed(3)
                : '—'
            }
          />
        </Card>
      ) : (
        <>
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
        </>
      )}

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
