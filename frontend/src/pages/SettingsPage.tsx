import type { ReactNode } from 'react'
import { Segmented } from '../components/Segmented'
import { ArrowCounterClockwise, SignOut, UserCircle } from '@phosphor-icons/react'
import { postureScore } from '../lib/postureScore'
import { DEFAULT_RULES } from '../data/posture'
import { Card, Switch } from '../components/ui'
import { useDesktopLaunch } from '../features/desktop/useDesktopLaunch'

type Rules = typeof DEFAULT_RULES

/** Three plain choices cover most people; exact sliders stay under "세밀하게 조정". */
const SENSITIVITY: [string, number][] = [
  ['느긋하게', 20],
  ['보통', 30],
  ['꼼꼼하게', 40],
]
const HOLD: [string, number][] = [
  ['3초', 3],
  ['5초', 5],
  ['10초', 10],
]
const REALERT: [string, number][] = [
  ['1분', 60],
  ['2분', 120],
  ['3분', 180],
]

const thresholdFor = (score: number) => Math.round((1 - score / 100) * 100) / 100

function Choice({
  label,
  options,
  value,
  onChange,
  unit,
}: {
  label: string
  options: [string, number][]
  value: number
  onChange: (v: number) => void
  unit: string
}) {
  const custom = !options.some(([, v]) => v === value)
  return (
    <div className="setting-control">
      {custom && <span className="fine">사용자 지정 {value}{unit}</span>}
      <Segmented label={label}>
        {options.map(([name, v]) => (
          <button key={name} aria-pressed={v === value} onClick={() => onChange(v)}>
            {name}
          </button>
        ))}
      </Segmented>
    </div>
  )
}

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
      <div className="setting-control">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={name}
        />
        <span className="slider-value">
          {value}
          {unit}
        </span>
      </div>
    </div>
  )
}

function Row({ name, desc, children }: { name: string; desc: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-name">{name}</div>
        <div className="setting-desc">{desc}</div>
      </div>
      {children}
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
  serviceMode = false,
  accountMode = false,
  account,
  onRegisterAgain,
  onCollect,
}: {
  serviceMode?: boolean
  accountMode?: boolean
  rules: Rules
  onRules: (r: Rules) => void
  alertsOn: boolean
  onAlerts: (v: boolean) => void
  hasHistory: boolean
  onHasHistory: (v: boolean) => void
  account?: { name: string; detail: string; onProfile: () => void; onLogout: () => void }
  onRegisterAgain?: () => void
  onCollect?: () => void
}) {
  const set = (patch: Partial<Rules>) => onRules({ ...rules, ...patch })
  const desktop = useDesktopLaunch()
  const score = postureScore(rules.threshold)!

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">설정</h1>
          <p className="page-desc">바뀐 설정은 다음 측정부터 적용돼요.</p>
        </div>
      </div>

      <div className="view">
        <div className="view-main">
          <Card title="알림">
            <Row
              name="자세 알림"
              desc={
                accountMode
                  ? '꺼도 기록은 계속 남아요. 화면 알림과 소리만 꺼져요.'
                  : '자세가 흐트러진 채로 이어지면 알려드려요. 소리는 측정 화면에서 켜고 끌 수 있어요.'
              }
            >
              {serviceMode && !accountMode ? (
                <span className="badge good">
                  <i className="pip" />
                  켜짐
                </span>
              ) : (
                <Switch checked={alertsOn} onChange={onAlerts} label="교정 알림 사용" />
              )}
            </Row>
            <Row name="얼마나 민감하게" desc="꼼꼼할수록 작은 변화에도 알려드려요.">
              <Choice
                label="알림 민감도"
                options={SENSITIVITY}
                value={score}
                unit="점"
                onChange={(v) => set({ threshold: thresholdFor(v) })}
              />
            </Row>
            <Row name="알리기까지 기다리는 시간" desc="잠깐 움직인 건 넘어가요.">
              <Choice
                label="알림 대기 시간"
                options={HOLD}
                value={rules.holdSeconds}
                unit="초"
                onChange={(v) => set({ holdSeconds: v })}
              />
            </Row>
            <Row name="다시 알리는 간격" desc="같은 자세가 계속될 때 다시 알려드려요.">
              <Choice
                label="재알림 간격"
                options={REALERT}
                value={rules.realertSeconds}
                unit="초"
                onChange={(v) => set({ realertSeconds: v })}
              />
            </Row>
          </Card>

          <details className="more">
            <summary>세밀하게 조정</summary>
            <div className="more-body">
              <Slider
                name="붕괴 확정 지속 시간"
                desc="이 시간만큼 이어져야 자세 이탈로 확정합니다."
                value={rules.holdSeconds}
                min={1}
                max={10}
                step={0.5}
                unit="초"
                onChange={(v) => set({ holdSeconds: v })}
              />
              <Slider
                name="재알림 간격"
                desc="같은 이탈이 이어질 때 다시 알리기까지의 최소 간격입니다."
                value={rules.realertSeconds}
                min={15}
                max={180}
                step={5}
                unit="초"
                onChange={(v) => set({ realertSeconds: v })}
              />
              <Slider
                name="정상 복귀 유지 시간"
                desc="이 시간만큼 바른 자세가 이어져야 복귀로 인정합니다."
                value={rules.recoverSeconds}
                min={1}
                max={10}
                step={0.5}
                unit="초"
                onChange={(v) => set({ recoverSeconds: v })}
              />
              <Slider
                name="자세 점수 알림 기준"
                desc="자세 점수가 이 값 이하로 이어지면 알립니다. 검증 전 값입니다."
                value={score}
                min={5}
                max={50}
                step={1}
                unit="점"
                onChange={(v) => set({ threshold: thresholdFor(v) })}
              />
              <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => onRules(DEFAULT_RULES)}>
                <ArrowCounterClockwise size={16} weight="bold" className="icon" />
                기본값으로 되돌리기
              </button>
            </div>
          </details>
          <Card title="측정">
            <Row name="기준 자세" desc="카메라 위치나 의자를 바꿨다면 다시 등록해 주세요.">
              <button className="chip" disabled={!onRegisterAgain} onClick={onRegisterAgain}>
                <ArrowCounterClockwise size={14} weight="bold" className="icon" />
                다시 등록
              </button>
            </Row>
          </Card>

          <Card title="컴퓨터를 켤 때">
            <Row
              name="자동으로 PoseGood 열기"
              desc={
                !desktop.desktop
                  ? '데스크톱 앱에서 설정할 수 있어요.'
                  : desktop.info?.launchAtLoginSupported
                    ? '컴퓨터를 켜면 시작 프로그램으로 열려요.'
                    : '설치용 앱으로 만든 뒤에 사용할 수 있어요. 지금은 개발 실행 중이에요.'
              }
            >
              <Switch
                checked={!!desktop.info?.launchAtLogin}
                onChange={(v) => void desktop.setLaunchAtLogin(v)}
                label="자동으로 PoseGood 열기"
                disabled={!desktop.info?.launchAtLoginSupported}
              />
            </Row>
            <Row
              name="열릴 때 카메라 바로 켜기"
              desc="자동으로 열렸을 때 카메라를 연결해요. 기준 자세는 한 번 확인해 주세요."
            >
              <Switch
                checked={!!desktop.info?.autoCamera}
                onChange={(v) => void desktop.setAutoCamera(v)}
                label="열릴 때 카메라 바로 켜기"
                disabled={!desktop.info}
              />
            </Row>
            {desktop.message && (
              <p role="status" className="fine">
                {desktop.message}
              </p>
            )}
          </Card>

        </div>

        <div className="view-side">
          {account && (
            <Card title="계정">
              <div className="account-row">
                <span className="avatar" aria-hidden="true">
                  {account.name.trim().slice(0, 1) || '나'}
                </span>
                <div>
                  <div className="setting-name">{account.name || '내 계정'}</div>
                  <div className="setting-desc">{account.detail}</div>
                </div>
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn btn-sm" onClick={account.onProfile}>
                  <UserCircle size={16} weight="bold" className="icon" />
                  프로필 설정
                </button>
                <button className="btn btn-sm btn-quiet" onClick={account.onLogout}>
                  <SignOut size={16} weight="bold" className="icon" />
                  로그아웃
                </button>
              </div>
            </Card>
          )}

          <details className="more">
            <summary>개발자 옵션 · 시연, 데이터 수집, 버전 정보</summary>
            <div className="more-body">
              <Row
                name="발표용 예시 기록 표시"
                desc={`켜면 기록 화면에 예시 데이터를, 끄면 ${accountMode ? '내 계정의' : '이 기기에 저장된'} 실제 측정 기록을 보여줘요.`}
              >
                <Switch checked={hasHistory} onChange={onHasHistory} label="발표용 예시 기록 표시" />
              </Row>
              {onCollect && (
                <Row name="자세 데이터 수집" desc="연구용 라벨 촬영 화면이에요. 관절 위치만 CSV로 저장해요.">
                  <button className="chip" onClick={onCollect}>
                    자세 데이터 수집
                  </button>
                </Row>
              )}
              <div className="setting-row">
                <div className="setting-name">판정 방식</div>
                <span className="mono">reference-rules-v0.1 · 5초 기준 등록</span>
              </div>
              <div className="setting-row">
                <div className="setting-name">전처리</div>
                <span className="mono">shoulder-normalized-v0.1</span>
              </div>
              <div className="setting-row">
                <div className="setting-name">관절 추출</div>
                <span className="mono">MediaPipe Pose (client)</span>
              </div>
            </div>
          </details>
        </div>
      </div>
    </>
  )
}
