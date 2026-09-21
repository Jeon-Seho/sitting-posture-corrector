import { ArrowCounterClockwise } from '@phosphor-icons/react'
import { postureScore } from '../lib/postureScore'
import { DEFAULT_RULES } from '../data/posture'
import { Card, DemoNote, Switch } from '../components/ui'

type Rules = typeof DEFAULT_RULES

function Slider({
  name,
  desc,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  name: string
  desc: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-name">{name}</div>
        <div className="setting-desc">{desc}</div>
      </div>
      <div className="row" style={{ flex: 'none' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={name}
          style={{ width: 160 }}
        />
        <span className="slider-value">
          {value}
          {unit}
        </span>
      </div>
    </div>
  )
}

export function SettingsPage({
  rules,
  onRules,
  alertsOn,
  onAlerts,
  hasHistory,
  onHasHistory,
}: {
  rules: Rules
  onRules: (r: Rules) => void
  alertsOn: boolean
  onAlerts: (v: boolean) => void
  hasHistory: boolean
  onHasHistory: (v: boolean) => void
}) {
  const set = (patch: Partial<Rules>) => onRules({ ...rules, ...patch })

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">설정</h1>
          <p className="page-desc">
            판정 파라미터는 계획서의 후보값을 기본으로 두었습니다. 실제 값은 사용자 실험 후
            확정합니다.
          </p>
        </div>
        <button className="btn" onClick={() => onRules(DEFAULT_RULES)}>
          <ArrowCounterClockwise size={17} weight="bold" className="icon" />
          기본값으로 되돌리기
        </button>
      </div>

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card title="알림">
            <div className="setting-row">
              <div>
                <div className="setting-name">교정 알림 사용</div>
                <div className="setting-desc">
                  꺼도 붕괴 이벤트는 계속 기록되며, 해당 구간은 회복 시간 집계에서 따로 표시됩니다.
                </div>
              </div>
              <Switch checked={alertsOn} onChange={onAlerts} label="교정 알림 사용" />
            </div>
            <Slider
              name="붕괴 확정 지속 시간"
              desc="이 시간만큼 이어져야 붕괴 이벤트로 확정합니다. 순간 동작을 걸러냅니다."
              value={rules.holdSeconds}
              min={1}
              max={10}
              step={0.5}
              unit="초"
              onChange={(v) => set({ holdSeconds: v })}
            />
            <Slider
              name="재알림 간격"
              desc="같은 이벤트가 이어질 때 다시 알리기까지의 최소 간격입니다."
              value={rules.realertSeconds}
              min={15}
              max={180}
              step={5}
              unit="초"
              onChange={(v) => set({ realertSeconds: v })}
            />
            <Slider
              name="정상 복귀 유지 시간"
              desc="이 시간만큼 바른 자세가 유지되어야 복귀로 인정합니다. 상태가 반복 전환되는 것을 막습니다."
              value={rules.recoverSeconds}
              min={1}
              max={10}
              step={0.5}
              unit="초"
              onChange={(v) => set({ recoverSeconds: v })}
            />
          </Card>

          <Card title="판정">
            <Slider
              name="자세 점수 알림 기준"
              desc="자세 점수가 이 값 이하로 지속되면 알립니다. 높일수록 작은 변화에도 알림이 생깁니다."
              value={postureScore(rules.threshold)!}
              min={5}
              max={50}
              step={1}
              unit="점"
              onChange={(v) => set({ threshold: Math.round((1 - v / 100) * 100) / 100 })}
            />
          </Card>
        </div>

        <div className="stack">
          <Card title="운영 정보" note="배포 버전을 식별할 수 있도록 화면에 남겨 둡니다." dark>
            <div className="setting-row">
              <div className="setting-name">실제 웹캠 판정</div>
              <span className="mono">{'reference-rules-v0.1'}</span>
            </div>
            <div className="setting-row">
              <div className="setting-name">전처리 설정 버전</div>
              <span className="mono">shoulder-normalized-v0.1</span>
            </div>
            <div className="setting-row">
              <div className="setting-name">현재 판정 방식</div>
              <span className="mono">프레임 규칙 / 5초 기준 등록</span>
            </div>
            <div className="setting-row">
              <div className="setting-name">키포인트 추출</div>
              <span className="mono">MediaPipe Pose (client)</span>
            </div>
            <div className="setting-row">
              <div className="setting-name">최근 오류</div>
              <span className="muted" style={{ fontSize: 13 }}>
                오류는 카메라 화면에서 표시
              </span>
            </div>
          </Card>

          <Card title="시연 옵션" note="발표 중 화면을 전환할 때 사용합니다.">
            <div className="setting-row">
              <div>
                <div className="setting-name">홈에 기록 표시</div>
                <div className="setting-desc">
                  끄면 기록이 없는 신규 사용자 화면으로 바뀝니다.
                </div>
              </div>
              <Switch checked={hasHistory} onChange={onHasHistory} label="홈에 기록 표시" />
            </div>
          </Card>

          <DemoNote>
            이 화면의 값은 브라우저 메모리에만 남습니다. 새로고침하면 기본값으로 돌아갑니다.
          </DemoNote>
        </div>
      </div>
    </>
  )
}
