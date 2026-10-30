import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { WarningCircle } from '@phosphor-icons/react'
import { activateModal, trapTab } from '../dialog/modalFocus'
import { ObservationScrollPanel } from './ObservationScrollPanel'

export function ObservationReplayInfo({ children, onOpen }: { children: ReactNode; onOpen: () => void }) {
  const [open, setOpen] = useState(false)
  return <div className="oc-replay-info">
    <button className="oc-replay-info-trigger" type="button" aria-label="기록 정보" title="기록 정보" aria-haspopup="dialog" onClick={() => { onOpen(); setOpen(true) }}><WarningCircle size={24} aria-hidden="true" /></button>
    {open && <RecordInfoDialog onClose={() => setOpen(false)}>{children}</RecordInfoDialog>}
  </div>
}
function RecordInfoDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null)
  const modal = useRef<ReturnType<typeof activateModal> | null>(null)
  useLayoutEffect(() => {
    if (dialog.current) modal.current = activateModal(dialog.current, close.current)
    return () => modal.current?.close()
  }, [])
  useEffect(() => () => modal.current?.restoreFocus(), [])
  return <dialog className="confirm-dialog oc-record-info-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); trapTab(event) }}
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}>
    <h2 id={`${id}-title`}>기록 정보</h2>
    <ObservationScrollPanel className="oc-record-info-scroll" role="region" label="리플레이 기록 상세 정보">{children}</ObservationScrollPanel>
    <div className="form-actions"><button type="button" ref={close} onClick={onClose}>닫기</button></div>
  </dialog>
}
