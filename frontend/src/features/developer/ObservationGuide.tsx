import { useRef, type ReactNode } from 'react'
import { useObservationMotion } from './useObservationMotion'
import { ObservationStopButton } from './ObservationStopButton'
import { COMPARISON_ACTIONS } from './comparisonDemo'
import { OBSERVATION_STEPS, type GuideMode, type GuideSnapshot } from './observationProtocol'
import type { ReferenceSetup } from './useObservationComparison'
import { boldNumbers } from './observationTypography'
import { ArrowCounterClockwise, Pause, Play } from '@phosphor-icons/react'

type Props = {
  guide: GuideSnapshot; ready: boolean; active?: boolean
  hasRecording?: boolean; onDownload?: () => void
  setup?: ReferenceSetup; mode?: GuideMode; onNext?: () => void
  children?: ReactNode
  onStart: () => void; onPause: () => void; onResume: () => void; onStop: () => void; onRegister?: () => void; onStartReference?: () => void; canStartReference?: boolean
}
const phaseTitles = { move: '준비 · 동작으로 이동', hold: '측정 · 그대로 유지', return: '복귀 준비' }
const phaseShortTitles = { move: '준비', hold: '측정', return: '복귀 준비' }
const pauseReasons = { user: '잠깐 멈췄어요.', hidden: '탭이 숨겨져 멈췄어요.', tracking_lost: '2D 추적이 끊겨 멈췄어요.', clock_gap: '화면 진행이 지연되어 멈췄어요.' }
function emphasize(text: string, terms: (string | undefined)[]) {
  const term = terms.find(value => value && text.includes(value))
  if (!term) return text
  const index = text.indexOf(term)
  return <>{text.slice(0, index)}<strong className="oc-action-highlight">{term}</strong>{text.slice(index + term.length)}</>
}

export function ObservationGuide({ guide, ready, active, hasRecording = false, onDownload, setup = { status: 'idle', remainingMs: 0 }, mode = guide.mode, onNext, children, onStart, onPause, onResume, onStop, onRegister, onStartReference, canStartReference = false }: Props) {
  const step = guide.step, running = guide.status === 'running', paused = guide.status === 'paused', waiting = guide.status === 'waiting'
  const finished = guide.status === 'completed' || guide.status === 'cancelled'
  const settingUp = ['connecting', 'preparing', 'registering'].includes(setup.status)
  const measuring = running && step?.phase === 'hold' && !settingUp
  const cameraActive = active ?? (ready || settingUp || running || paused || waiting)
  const task = COMPARISON_ACTIONS.find(action => action.id === step?.action)
  const next = OBSERVATION_STEPS[step ? guide.stepIndex + 1 : 0]
  const nextTask = COMPARISON_ACTIONS.find(action => action.id === next?.action)
  const nextLabel = !next ? '측정 완료' : next.phase === 'hold' ? '측정 시작' : next.phase === 'return' ? '기준 자세로 복귀' : '다음 동작 준비'
  const title = guide.status === 'completed' ? '3바퀴 안내 완료' : guide.status === 'cancelled' ? '안내를 중단했어요' : paused ? `${step?.phase === 'return' ? '기준 복귀' : task?.title} · 일시 정지` : step?.phase === 'return' ? '편안한 기준 자세로 돌아오세요' : task?.title ?? '네 동작을 3바퀴, 화면을 따라 하세요'
  const resumeInstruction = step?.phase === 'hold' ? `‘${task?.title}’ 자세를 다시 잡고 추적을 확인한 뒤 재개하세요. 측정 5초를 다시 셉니다.` : step?.phase === 'return' ? '기준 자세로 돌아갈 준비를 하고 추적을 확인한 뒤 재개하세요. 복귀 준비 5초를 다시 셉니다.' : '기준 자세에서 추적을 확인한 뒤 재개하세요. 준비 2초를 다시 셉니다.'
  const instruction = paused ? `${pauseReasons[guide.pauseReason ?? 'user']} ${resumeInstruction}` : waiting ? next?.phase === 'hold' ? `‘${nextTask?.title}’ 자세를 잡고 준비되면 측정을 시작하세요. 대기 중에는 자료를 모으지 않습니다.` : next?.phase === 'return' ? '측정이 끝났어요. 준비되면 기준 자세로 돌아가세요.' : next ? `준비되면 ‘${nextTask?.title}’ 동작을 시작하세요. 대기 중에는 자료를 모으지 않습니다.` : '모든 단계가 끝났어요. 측정을 완료해 주세요.' : step?.phase === 'hold' ? task?.holdInstruction ?? '지금 자세를 편안하게 유지하세요.' : step?.phase === 'return' ? '등록했던 편안한 정면 자세로 돌아와 다음 동작까지 쉬세요. 자료 수집은 멈춥니다.' : task?.instruction ?? '준비되면 기준 자세 등록을 시작하세요.'
  const setupTitle = setup.status === 'connecting' ? '카메라를 연결하고 있어요' : setup.status === 'preparing' ? '편안한 기준 자세를 잡아 주세요' : setup.status === 'registering' ? '편안한 기준 자세를 유지하세요' : setup.status === 'interrupted' ? '기준 등록을 다시 시작하세요' : null
  const completed = guide.status === 'completed' ? OBSERVATION_STEPS.length : step ? guide.stepIndex + (waiting ? 1 : 0) : 0
  const seconds = settingUp ? setup.remainingMs : guide.remainingMs
  const panel = useRef<HTMLDivElement>(null)
  useObservationMotion(panel, `${cameraActive}:${setup.status}:${guide.status}:${mode}:${!!next}`)
  return <section className={`oc-guide${running ? ' is-running' : ''}${paused ? ' is-paused' : ''}`} data-state={guide.status} data-measuring={measuring} data-camera-active={cameraActive} aria-label="동작 안내">
    <div className="oc-stage">
      {children}
      {(cameraActive || finished) && <span className="oc-guide-progress" aria-hidden="true">{boldNumbers(`${completed} / ${OBSERVATION_STEPS.length}구간`)}</span>}
    </div>
    <div className="oc-guide-panel" ref={panel}>
      {cameraActive && setup.status !== 'connecting' && <div className="oc-guide-clock" role="timer" aria-live="off" aria-label="현재 단계 남은 시간">
        <h3 className="oc-clock-task">{emphasize(setupTitle ?? (waiting ? next?.phase === 'hold' ? '준비되면 측정을 시작하세요' : next ? '준비되면 다음 단계로' : '모든 단계가 끝났어요' : finished ? title : step ? step.phase === 'return' ? '편안한 기준 자세' : task?.title ?? '' : ready ? '동작 안내를 시작하세요' : '카메라를 켜 주세요'), ['기준 자세', task?.title])}</h3>
        <div className="oc-clock-meta"><span className="oc-clock-label">{boldNumbers(settingUp ? setup.status === 'registering' ? '기준 등록 · 8초' : '시작 준비' : paused ? '일시 정지' : waiting ? '시간 완료 · 다음 대기' : running && step ? phaseTitles[step.phase] : finished ? '측정 종료' : '시작 준비')}</span><span className="oc-clock-position">{boldNumbers(step ? `${step.round} / 3바퀴 · ${(step.trial - 1) % 4 + 1} / 4동작` : '4동작 · 3바퀴')}</span></div>
        {!waiting && setup.status !== 'preparing' && <div className="oc-clock-count"><strong>{setup.status === 'registering' || running || paused ? String(Math.ceil(seconds / 1000)).padStart(2, '0') : guide.status === 'completed' ? '36' : '—'}</strong><span>{setup.status === 'registering' || running || paused ? '초' : guide.status === 'completed' ? '구간' : '대기'}</span></div>}
        {!measuring && !finished && <p className="oc-guide-instruction" aria-hidden="true">{emphasize(settingUp ? setup.status === 'preparing' ? '얼굴과 양어깨를 확인하고 준비되면 기준 등록을 시작하세요.' : setup.status === 'registering' ? '편안한 정면 자세를 유지하세요.' : '얼굴과 양어깨가 보이도록 앉아 주세요.' : instruction, ['기준 자세', waiting ? nextTask?.title : task?.title])}</p>}
        {!finished && !settingUp && <p className="oc-guide-next" aria-label="다음 안내"><span>{step ? '다음' : '첫 동작'}</span><strong>{boldNumbers(next ? next.phase === 'return' ? '편안한 기준 자세' : nextTask?.title ?? '' : '3바퀴 완료 · CSV 받기')}</strong><small>{boldNumbers(next ? mode === 'manual' && next.phase === 'move' ? '· 준비 후 직접 시작' : `· ${phaseShortTitles[next.phase]} ${next.durationMs / 1000}초` : '카메라가 꺼지고 자료는 남아요.')}</small></p>}
      </div>}
      <div className="oc-guide-controls">
        {!cameraActive && <button className="oc-primary oc-start-guide" onClick={onStart}>{hasRecording ? '다시 측정' : '카메라 켜기'}</button>}
        {!cameraActive && hasRecording && <button className="oc-json-download" onClick={onDownload}>JSON 다운로드</button>}
        {cameraActive && setup.status === 'preparing' && <button className="oc-primary oc-wait-next" aria-label="기준 자세 등록 시작" disabled={!canStartReference} onClick={onStartReference}>기준 자세 등록 시작 <span aria-hidden="true">↵</span></button>}
        {cameraActive && waiting && mode === 'manual' && <button className="oc-primary oc-wait-next" aria-label={nextLabel} disabled={!ready} onClick={onNext}>{nextLabel} <span aria-hidden="true">↵</span></button>}
        {cameraActive && <button className={`oc-pause-guide${paused ? ' oc-resume-guide' : ''}`} disabled={paused ? !ready : !running} aria-label={paused ? '현재 단계 처음부터 재개' : '잠깐 멈춤'} title={paused ? '현재 단계를 처음부터 재개' : '잠깐 멈춤'} onClick={paused ? onResume : onPause}>{paused ? <Play size={18} weight="fill" aria-hidden="true" /> : <Pause size={18} weight="fill" aria-hidden="true" />}</button>}
        {cameraActive && onRegister && <button className="oc-register-guide" aria-label="기준 자세 다시 측정" title="기준 자세 다시 측정" onClick={onRegister}><ArrowCounterClockwise size={18} aria-hidden="true" /></button>}
        {cameraActive && <ObservationStopButton onStop={onStop} />}
      </div>
      {!finished && <p className="oc-sr-only" role="status" aria-atomic="true">{settingUp ? setup.status === 'registering' ? '편안한 정면 자세를 8초 유지하세요. 기준 등록이 끝나면 선택한 모드로 이어집니다.' : '얼굴과 양어깨를 확인하고 준비되면 기준 자세 등록을 시작하세요.' : running || paused || waiting ? `${title} · ${instruction}` : ''}</p>}
    </div>
    <progress className="oc-sr-only" value={completed} max={OBSERVATION_STEPS.length} aria-label="완료한 안내 구간" />
  </section>
}
