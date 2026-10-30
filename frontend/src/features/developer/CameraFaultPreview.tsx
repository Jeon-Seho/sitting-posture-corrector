import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ThemeIllustration } from '../appearance/ThemeIllustration'
import { PerformanceDialog } from '../camera/CameraPerformanceDialog'
import { runCameraErrorScenario } from './cameraErrorScenario'
import { probeAcceleration, type PerformanceNotice } from '../camera/acceleration'
import { CAMERA_ERRORS, cameraPreparationError } from '../camera/errors'
import { detectorFallback } from '../camera/detectorFallback'
import { activateModal, trapTab } from '../dialog/modalFocus'

export const FAULT_SCENARIOS = { fallback: 'GPU 실패 → CPU 성공', failed: 'GPU·CPU 모두 실패', timeout: '준비 시간 초과', cancel: '전환 중 취소' } as const
export type FaultScenario = keyof typeof FAULT_SCENARIOS
type Phase = 'gpu' | 'cpu' | 'ready' | 'failed' | 'timeout' | 'cancelled' | 'permission' | 'connected' | 'tracking' | 'limited' | 'unknown'
const TITLES: Record<Phase, string> = {
  permission: '카메라 권한을 확인하고 있어요…', connected: '카메라 연결을 확인하고 있어요…', tracking: '영상에서 자세를 인식하고 있어요…', limited: '그래픽 가속이 제한됐어요', unknown: '그래픽 가속 상태를 확인하지 못했어요',
  gpu: '카메라를 준비하고 있어요…', cpu: 'CPU로 다시 준비하고 있어요…', ready: '카메라가 준비됐어요',
  failed: '카메라를 준비하지 못했어요', timeout: '카메라 준비가 오래 걸려요', cancelled: '카메라 준비를 취소했어요',
}

export function CameraFaultPreview({ scenario, onClose, errorKey, performance }: { scenario: FaultScenario; onClose: () => void; errorKey?: keyof typeof CAMERA_ERRORS; performance?: 'limited' | 'unknown' }) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const modal = useRef<ReturnType<typeof activateModal> | null>(null)
  const generation = useRef(0)
  const active = useRef(false)
  const [run, setRun] = useState(0)
  const [phase, setPhase] = useState<Phase>('gpu')
  const [notice, setNotice] = useState<PerformanceNotice | null>(null)
  const [failure, setFailure] = useState('')
  const [diagnostic, setDiagnostic] = useState({ attempts: [] as string[], closed: 0 })
  const loading = ['gpu', 'cpu', 'permission', 'connected', 'tracking'].includes(phase)

  useLayoutEffect(() => {
    if (dialog.current) modal.current = activateModal(dialog.current, closeButton.current)
    return () => modal.current?.close()
  }, [])
  useEffect(() => () => modal.current?.restoreFocus(), [])

  useEffect(() => {
    const token = ++generation.current
    active.current = true
    const isCurrent = () => active.current && generation.current === token
    const mountedRun = () => generation.current === token
    const waits = new Set<{ timer: ReturnType<typeof setTimeout>; resolve: () => void }>()
    const delay = (ms: number) => new Promise<void>(resolve => {
      const entry = { timer: setTimeout(() => { waits.delete(entry); resolve() }, ms), resolve }
      waits.add(entry)
    })
    const disposers: Array<() => void> = []
    setPhase('gpu')
    setFailure('')
    setNotice(null)
    setDiagnostic({ attempts: [], closed: 0 })
    void (async () => {
      try {
        if (errorKey) {
          await runCameraErrorScenario(errorKey, delay, isCurrent, next => {
            if (isCurrent()) { setPhase(next); setDiagnostic(previous => ({ ...previous, attempts: [...previous.attempts, next] })) }
          }, dispose => disposers.push(dispose))
          if (mountedRun() && !active.current) setPhase('cancelled')
          return
        }
        if (performance) {
          await delay(1000)
          if (!isCurrent()) return
          const result = probeAcceleration(() => {
            if (performance === 'unknown') throw new Error('Synthetic graphics restriction')
            return null
          })
          setPhase(result === 'limited' ? 'limited' : 'unknown')
          setNotice(result)
          return
        }
        const result = await detectorFallback(async delegate => {
          if (isCurrent()) {
            setPhase(delegate === 'GPU' ? 'gpu' : 'cpu')
            setDiagnostic(previous => ({ ...previous, attempts: [...previous.attempts, delegate] }))
          }
          await delay(scenario === 'timeout' ? 2400 : 1000)
          const resource = { close: () => {
            if (mountedRun()) setDiagnostic(previous => ({ ...previous, closed: previous.closed + 1 }))
          } }
          if (!isCurrent()) return resource
          if (scenario !== 'timeout' && delegate === 'GPU') throw new Error('Synthetic GPU failure')
          if (scenario === 'failed') throw new Error('Synthetic CPU failure')
          if (scenario === 'cancel') active.current = false
          return resource
        }, isCurrent, 'GPU', scenario === 'timeout' ? 1600 : 5000)
        result?.detector.close()
        if (!mountedRun()) return
        setPhase(result ? 'ready' : 'cancelled')
        if (result) setNotice('cpu')
      } catch (error) {
        console.error('[developer] Synthetic detector scenario', error)
        if (isCurrent()) { setFailure(cameraPreparationError(error)); setPhase(errorKey === 'preparationTimeout' || (!errorKey && scenario === 'timeout') ? 'timeout' : 'failed') }
      }
    })()
    return () => {
      active.current = false
      generation.current++
      for (const dispose of disposers) dispose()
      for (const entry of waits) { clearTimeout(entry.timer); entry.resolve() }
      waits.clear()
    }
  }, [scenario, run, errorKey, performance])

  function cancel() {
    active.current = false
    setPhase('cancelled')
  }
  const description = phase === 'failed' ? failure || CAMERA_ERRORS.preparationFailed
    : phase === 'timeout' ? CAMERA_ERRORS.preparationTimeout
    : phase === 'limited' ? '소프트웨어 그래픽 처리 환경을 주입해 실제 지원 검사 코드를 실행했어요.'
    : phase === 'unknown' ? '지원 검사에 오류를 주입해 실제 확인 불가 경로를 실행했어요.'
    : phase === 'cpu' ? '그래픽 처리를 시작하지 못했어요. 다른 방법으로 카메라를 준비하고 있어요.'
    : phase === 'ready' ? 'CPU 처리로 이어갈 수 있어요. 기기 성능에 따라 화면과 자세 인식이 느려질 수 있어요.'
    : phase === 'cancelled' ? '다시 준비하려면 아래 버튼을 눌러 주세요.'
    : '잠시만 기다려 주세요. 카메라와 자세 인식을 준비하고 있어요.'
  return <>
    <dialog ref={dialog} className="confirm-dialog camera-fault-preview" role="dialog" aria-modal="true"
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onKeyDown={trapTab}
      onCancel={event => { event.preventDefault(); onClose() }}>
      <header className="fault-preview-head"><div><p className="fine">사용자 화면 미리보기</p><h2 id={`${id}-title`}>{errorKey ? '카메라 오류 상황 재현' : performance ? '그래픽 가속 상황 재현' : FAULT_SCENARIOS[scenario]}</h2></div>
        <button ref={closeButton} className="btn btn-sm" onClick={onClose}>미리보기 닫기</button></header>
      <p id={`${id}-description`} className="fine">실제 카메라를 켜지 않고 준비·복구 흐름을 재현해요.</p>
      <div className={`fault-preview-stage is-${phase}`} aria-busy={loading}>
        <span className="fault-preview-label">미리보기 · 실제 영상 아님</span>
        <ThemeIllustration kind={phase === 'ready' ? 'baseline' : 'camera'} className="fault-preview-art" />
        <div className="fault-preview-state" role="status" aria-live="polite">
          {loading && <span className="fault-preview-spinner" aria-hidden="true" />}
          <h3>{TITLES[phase]}</h3><p>{description}</p>
        </div>
      </div>
      <div className="fault-preview-actions">
        {loading ? <button className="btn" onClick={cancel}>카메라 준비 취소</button>
          : <button className="btn btn-primary" onClick={() => setRun(value => value + 1)}>{phase === 'ready' ? '다시 재현하기' : '카메라 다시 준비'}</button>}
        {!loading && <button className="btn" onClick={onClose}>테스트 종료</button>}
      </div>
      <details className="fault-preview-diagnostics"><summary>진단 정보</summary><p>시도 {diagnostic.attempts.join(' → ')} · 자원 해제 {diagnostic.closed}</p></details>
    </dialog>
    {notice && <PerformanceDialog notice={notice} preview onDismiss={() => setNotice(null)} />}
  </>
}
