import type { ReactNode } from 'react'
import { COMPARISON_ACTIONS } from './comparisonDemo'
import { OBSERVATION_STEPS, type GuideSnapshot } from './observationProtocol'

type Props = {
  guide: GuideSnapshot; ready: boolean; hasTrace: boolean
  children?: ReactNode
  onStart: () => void; onPause: () => void; onResume: () => void; onStop: () => void; onExport: () => void
}
const phaseTitles = { move: '동작으로 이동', hold: '그대로 유지', return: '기준 복귀 · 유지' }
const phaseShortTitles = { move: '이동', hold: '유지', return: '복귀' }
const pauseReasons = { user: '잠깐 멈췄어요.', hidden: '탭이 숨겨져 멈췄어요.', tracking_lost: '2D 추적이 끊겨 멈췄어요.', clock_gap: '화면 진행이 지연되어 멈췄어요.' }

export function ObservationGuide({ guide, ready, hasTrace, children, onStart, onPause, onResume, onStop, onExport }: Props) {
  const step = guide.step, running = guide.status === 'running', paused = guide.status === 'paused'
  const finished = guide.status === 'completed' || guide.status === 'cancelled'
  const task = COMPARISON_ACTIONS.find(action => action.id === step?.action)
  const title = guide.status === 'completed' ? '3바퀴 안내 완료' : guide.status === 'cancelled' ? '안내를 중단했어요' : paused ? `${step?.phase === 'return' ? '기준 복귀' : task?.title} · 일시 정지` : step?.phase === 'return' ? '편안한 기준 자세로 돌아오세요' : task?.title ?? '네 동작을 3바퀴, 화면을 따라 하세요'
  const resumeInstruction = step?.phase === 'hold' ? `‘${task?.title}’ 자세를 다시 잡고 추적을 확인한 뒤 재개하세요. 유지 5초를 다시 셉니다.` : step?.phase === 'return' ? '기준 자세로 돌아갈 준비를 하고 추적을 확인한 뒤 재개하세요. 복귀·유지 5초를 다시 셉니다.' : '기준 자세에서 추적을 확인한 뒤 재개하세요. 동작으로 이동하는 2초를 다시 셉니다.'
  const instruction = finished ? '자료를 보존했어요. 관측 시계열 CSV를 내려받아 동작·단계별로 비교하세요.' : paused ? `${pauseReasons[guide.pauseReason ?? 'user']} ${resumeInstruction}` : step?.phase === 'hold' ? task?.holdInstruction ?? '지금 자세를 편안하게 유지하세요.' : step?.phase === 'return' ? '등록했던 편안한 정면 자세로 돌아와 다음 동작까지 쉬세요.' : task?.instruction ?? '기준 자세에서 시작하세요. 머리 앞으로 → 고개 숙이기 → 몸통 접근 → 양쪽 어깨 함께 올리기를 3바퀴 진행해요.'
  const completed = guide.status === 'completed' ? OBSERVATION_STEPS.length : step ? guide.stepIndex : 0
  const next = OBSERVATION_STEPS[step ? guide.stepIndex + 1 : 0]
  const nextTask = COMPARISON_ACTIONS.find(action => action.id === next?.action)
  return <section className={`oc-guide${running ? ' is-running' : ''}${paused ? ' is-paused' : ''}`} data-state={guide.status} aria-label="자동 동작 안내">
    <div className="oc-stage">
      {children}
      <div className="oc-guide-clock" role="timer" aria-live="off" aria-label="현재 단계 남은 시간">
        <h3 className="oc-clock-task">{finished ? title : step ? step.phase === 'return' ? '편안한 기준 자세' : task?.title : ready ? '자동 안내를 시작하세요' : '기준 자세를 등록하세요'}</h3>
        <span className="oc-clock-label">{paused ? '일시 정지' : running && step ? phaseTitles[step.phase] : finished ? '측정 종료' : '시작 준비'}</span>
        <div><strong>{running || paused ? String(Math.ceil(guide.remainingMs / 1000)).padStart(2, '0') : guide.status === 'completed' ? '36' : '—'}</strong><span>{running || paused ? '초' : guide.status === 'completed' ? '구간' : '대기'}</span></div>
        <span>{step ? `${step.round} / 3바퀴 · ${(step.trial - 1) % 4 + 1} / 4동작` : '4동작 · 3바퀴'}</span>
        {!finished && <p className="oc-guide-next" aria-label="다음 안내"><span>{step ? '다음' : '첫 동작'}</span><strong>{next ? next.phase === 'return' ? '편안한 기준 자세' : nextTask?.title : '3바퀴 완료 · CSV 받기'}</strong><small>{next ? `· ${phaseShortTitles[next.phase]} ${next.durationMs / 1000}초` : '카메라가 꺼지고 자료는 남아요.'}</small></p>}
      </div>
      <div className="oc-guide-controls">
      {!running && !paused && !finished && <button className="oc-primary oc-start-guide" disabled={!ready} onClick={onStart}>3바퀴 자동 안내 시작</button>}
      {running && <button onClick={onPause}>잠깐 멈춤</button>}
      {paused && <button className="oc-primary" disabled={!ready} onClick={onResume}>현재 단계 처음부터 재개</button>}
      {(running || paused) && <button onClick={onStop}>안내·측정 종료</button>}
      {paused && hasTrace && <button onClick={onExport}>지금까지 시계열 CSV</button>}
      {finished && <button className="oc-primary" disabled={!hasTrace} onClick={onExport}>자동 안내 시계열 CSV</button>}
      </div>
      <p className={paused || finished ? 'oc-guide-notice' : 'oc-sr-only'} role="status" aria-atomic="true">{running || paused || finished ? `${title} · ${instruction}` : ''}</p>
      <span className="oc-guide-progress" aria-hidden="true">{completed} / {OBSERVATION_STEPS.length}구간</span>
    </div>
    <progress className="oc-sr-only" value={completed} max={OBSERVATION_STEPS.length} aria-label="완료한 안내 구간" />
  </section>
}
