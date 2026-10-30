import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { activateModal, trapTab } from '../dialog/modalFocus'
import { dismissPerformanceNotice, getPerformanceNotice, subscribePerformanceNotice } from './acceleration'

export function CameraPerformanceDialog() {
  const notice = useSyncExternalStore(subscribePerformanceNotice, getPerformanceNotice)
  return notice ? <PerformanceDialog notice={notice} /> : null
}

function PerformanceDialog({ notice }: { notice: string }) {
  const id = useId()
  const ref = useRef<HTMLDialogElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const modal = useRef<ReturnType<typeof activateModal> | null>(null)
  useLayoutEffect(() => {
    if (ref.current) modal.current = activateModal(ref.current, button.current)
    return () => modal.current?.close()
  }, [])
  useEffect(() => () => modal.current?.restoreFocus(), [])
  return (
    <dialog ref={ref} className="confirm-dialog" role="alertdialog" aria-modal="true"
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onKeyDown={trapTab}
      onCancel={(event) => { event.preventDefault(); dismissPerformanceNotice() }}>
      <h2 id={`${id}-title`}>카메라 처리 성능 안내</h2>
      <div id={`${id}-description`} className="profile-text">
        <p>{notice === 'cpu' ? 'GPU 처리를 시작하지 못해 CPU 처리로 전환했어요.'
          : notice === 'limited' ? '그래픽 가속을 사용할 수 없거나 소프트웨어 그래픽 처리 환경으로 보여요.'
          : notice === 'available' ? '그래픽 가속을 지원하는 환경으로 보여요.'
          : '이 브라우저에서는 그래픽 가속 상태를 확인하기 어려워요.'}</p>
        <p>하드웨어 가속이 꺼져 있거나 CPU로 처리하면 자세 인식과 카메라 화면이 느려지거나 끊길 수 있어요. 성능 차이는 기기와 브라우저에 따라 달라요.</p>
        <p>Chrome·Edge의 설정 → 시스템에서 ‘가능한 경우 그래픽 가속 사용’을 켜고 브라우저를 다시 시작해 주세요. Firefox는 설정 → 일반 → 성능에서 하드웨어 가속을 확인해 주세요.</p>
        <p className="fine">사이트에서는 브라우저 설정을 직접 읽거나 변경할 수 없어요. 그래픽 드라이버나 브라우저의 제한도 원인일 수 있어요.</p>
      </div>
      <div className="form-actions"><button ref={button} className="btn btn-primary" onClick={dismissPerformanceNotice}>확인</button></div>
    </dialog>
  )
}
