import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { activateModal, trapTab } from './modalFocus'

type Props = {
  title: string
  children: ReactNode
  confirmLabel: string
  disabled?: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  formatError?: (error: unknown) => string
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  disabled = false,
  onCancel,
  onConfirm,
  formatError,
}: Props) {
  const id = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const mounted = useRef(false)
  const modal = useRef<ReturnType<typeof activateModal> | null>(null)
  const confirming = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useLayoutEffect(() => {
    mounted.current = true
    modal.current = dialogRef.current ? activateModal(dialogRef.current, cancelRef.current) : null
    return () => {
      mounted.current = false
      modal.current?.close()
    }
  }, [])

  useEffect(() => {
    // Passive cleanup runs after React removes the old dialog and commits the next screen.
    // Restoration therefore does not depend on the browser scheduling another painted frame.
    return () => modal.current?.restoreFocus()
  }, [])

  function cancel() {
    if (!confirming.current) onCancel()
  }

  async function confirm() {
    if (disabled || confirming.current) return
    confirming.current = true
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (failure) {
      if (mounted.current)
        setError(formatError?.(failure) ?? '처리하지 못했습니다. 취소하거나 다시 시도해 주세요.')
    } finally {
      confirming.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      aria-busy={busy}
      tabIndex={-1}
      onKeyDown={trapTab}
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        const outside =
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        if (outside) cancel()
      }}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      <div id={`${id}-description`} className="profile-text">
        {children}
      </div>
      {busy && <p role="status">처리 중입니다. 잠시 기다려 주세요.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="form-actions">
        <button ref={cancelRef} type="button" className="btn" disabled={busy} onClick={cancel}>
          취소
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={disabled || busy}
          onClick={confirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
