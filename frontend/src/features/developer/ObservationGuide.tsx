import type { ReactNode } from 'react'
import { COMPARISON_ACTIONS } from './comparisonDemo'
import { OBSERVATION_STEPS, type GuideMode, type GuideSnapshot } from './observationProtocol'
import type { ReferenceSetup } from './useObservationComparison'
import { boldNumbers } from './observationTypography'

type Props = {
  guide: GuideSnapshot; ready: boolean; active?: boolean
  setup?: ReferenceSetup; mode?: GuideMode; onNext?: () => void
  children?: ReactNode
  onStart: () => void; onPause: () => void; onResume: () => void
}
const phaseTitles = { move: '준비 · 동작으로 이동', hold: '측정 · 그대로 유지', return: '복귀 준비' }
const phaseShortTitles = { move: '준비', hold: '측정', return: '복귀 준비' }
const pauseReasons = { user: '잠깐 멈췄어요.', hidden: '탭이 숨겨져 멈췄어요.', tracking_lost: '2D 추적이 끊겨 멈췄어요.', clock_gap: '화면 진행이 지연되어 멈췄어요.' }

export function ObservationGuide({ guide, ready, active, setup = { status: 'idle', remainingMs: 0 }, mode = guide.mode, onNext, children, onStart, onPause, onResume }: Props) {
  const step = guide.step, running = guide.status === 'running', paused = guide.status === 'paused', waiting = guide.status === 'waiting'
  const finished = guide.status === 'completed' || guide.status === 'cancelled'
  const settingUp = ['connecting', 'preparing', 'registering'].includes(setup.status)
  const cameraActive = active ?? (ready || settingUp || running || paused || waiting)
  const task = COMPARISON_ACTIONS.find(action => action.id === step?.action)
  const title = guide.status === 'completed' ? '3바퀴 안내 완료' : guide.status === 'cancelled' ? '안내를 중단했어요' : paused ? `${step?.phase === 'return' ? '기준 복귀' : task?.title} · 일시 정지` : step?.phase === 'return' ? '편안한 기준 자세로 돌아오세요' : task?.title ?? '네 동작을 3바퀴, 화면을 따라 하세요'
  const resumeInstruction = step?.phase === 'hold' ? `‘${task?.title}’ 자세를 다시 잡고 추적을 확인한 뒤 재개하세요. 측정 5초를 다시 셉니다.` : step?.phase === 'return' ? '기준 자세로 돌아갈 준비를 하고 추적을 확인한 뒤 재개하세요. 복귀 준비 5초를 다시 셉니다.' : '기준 자세에서 추적을 확인한 뒤 재개하세요. 준비 2초를 다시 셉니다.'
  const instruction = paused ? `${pauseReasons[guide.pauseReason ?? 'user']} ${resumeInstruction}` : waiting ? '시간이 끝났어요. 다음 버튼을 누르면 이어집니다. 기다리는 동안은 자료를 모으지 않습니다.' : step?.phase === 'hold' ? task?.holdInstruction ?? '지금 자세를 편안하게 유지하세요.' : step?.phase === 'return' ? '등록했던 편안한 정면 자세로 돌아와 다음 동작까지 쉬세요. 자료 수집은 멈춥니다.' : task?.instruction ?? '카메라 연결 후 2초 안내하고 기준 자세를 8초 등록합니다.'
  const setupTitle = setup.status === 'connecting' ? '카메라를 연결하고 있어요' : setup.status === 'preparing' ? '기준 자세를 등록합니다' : setup.status === 'registering' ? '편안한 기준 자세를 유지하세요' : setup.status === 'interrupted' ? '기준 등록을 다시 시작하세요' : null
  const completed = guide.status === 'completed' ? OBSERVATION_STEPS.length : step ? guide.stepIndex + (waiting ? 1 : 0) : 0
  const next = OBSERVATION_STEPS[step ? guide.stepIndex + 1 : 0]
  const nextTask = COMPARISON_ACTIONS.find(action => action.id === next?.action)
  const seconds = settingUp ? setup.remainingMs : guide.remainingMs
  return <section className={`oc-guide${running ? ' is-running' : ''}${paused ? ' is-paused' : ''}`} data-state={guide.status} aria-label="동작 안내">
    <div className="oc-stage">
      {children}
      {cameraActive && <div className="oc-guide-clock" role="timer" aria-live="off" aria-label="현재 단계 남은 시간">
        <h3 className="oc-clock-task">{setupTitle ?? (finished ? title : step ? step.phase === 'return' ? '편안한 기준 자세' : task?.title : ready ? '동작 안내를 시작하세요' : '카메라를 켜 주세요')}</h3>
        <div className="oc-clock-meta"><span className="oc-clock-label">{boldNumbers(settingUp ? setup.status === 'registering' ? '기준 등록 · 8초' : setup.status === 'connecting' ? '시작 준비' : '2초 뒤 기준 등록' : paused ? '일시 정지' : waiting ? '시간 완료 · 다음 대기' : running && step ? phaseTitles[step.phase] : finished ? '측정 종료' : '시작 준비')}</span><span className="oc-clock-position">{boldNumbers(step ? `${step.round} / 3바퀴 · ${(step.trial - 1) % 4 + 1} / 4동작` : '4동작 · 3바퀴')}</span></div>
        <div className="oc-clock-count"><strong>{settingUp && setup.status !== 'connecting' || running || paused || waiting ? String(Math.ceil(seconds / 1000)).padStart(2, '0') : guide.status === 'completed' ? '36' : '—'}</strong><span>{settingUp || running || paused || waiting ? '초' : guide.status === 'completed' ? '구간' : '대기'}</span></div>
        {!finished && !settingUp && <p className="oc-guide-next" aria-label="다음 안내"><span>{step ? '다음' : '첫 동작'}</span><strong>{boldNumbers(next ? next.phase === 'return' ? '편안한 기준 자세' : nextTask?.title ?? '' : '3바퀴 완료 · CSV 받기')}</strong><small>{boldNumbers(next ? `· ${phaseShortTitles[next.phase]} ${next.durationMs / 1000}초` : '카메라가 꺼지고 자료는 남아요.')}</small></p>}
      </div>}
      <div className="oc-guide-controls">
        {!cameraActive && <button className="oc-primary oc-start-guide" onClick={onStart}>카메라 켜기</button>}
        {cameraActive && mode === 'manual' && !finished && <button className="oc-primary oc-next-guide" disabled={!waiting || !ready} onClick={onNext}>{step && !next ? '완료' : '다음'}</button>}
        {cameraActive && running && <button className="oc-pause-guide" onClick={onPause}>잠깐 멈춤</button>}
        {cameraActive && paused && <button className="oc-primary" disabled={!ready} onClick={onResume}>현재 단계 처음부터 재개</button>}
      </div>
      {!finished && <p className="oc-sr-only" role="status" aria-atomic="true">{settingUp ? setup.status === 'registering' ? '편안한 정면 자세를 8초 유지하세요. 기준 등록이 끝나면 선택한 모드로 이어집니다.' : '2초 뒤 기준 자세를 8초 등록합니다. 얼굴과 양어깨가 보이도록 앉아 주세요.' : running || paused || waiting ? `${title} · ${instruction}` : ''}</p>}
      {(cameraActive || finished) && <span className="oc-guide-progress" aria-hidden="true">{boldNumbers(`${completed} / ${OBSERVATION_STEPS.length}구간`)}</span>}
    </div>
    <progress className="oc-sr-only" value={completed} max={OBSERVATION_STEPS.length} aria-label="완료한 안내 구간" />
  </section>
}
