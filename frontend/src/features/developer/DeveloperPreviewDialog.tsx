import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { activateModal, trapTab } from '../dialog/modalFocus'

export function DeveloperPreviewDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const modal = useRef<ReturnType<typeof activateModal> | null>(null)
  useLayoutEffect(() => {
    if (dialog.current) modal.current = activateModal(dialog.current, close.current)
    return () => modal.current?.close()
  }, [])
  useEffect(() => () => modal.current?.restoreFocus(), [])
  return <dialog ref={dialog} className="confirm-dialog camera-fault-preview" role="dialog" aria-modal="true" aria-labelledby={id}
    onKeyDown={trapTab} onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="fault-preview-head"><div><p className="fine">사용자 화면 미리보기</p><h2 id={id}>{title}</h2></div>
      <button ref={close} className="btn btn-sm" onClick={onClose}>미리보기 닫기</button></header>
    {children}
  </dialog>
}
