import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { X } from '../../components/icons'
import { activateModal, trapTab } from '../dialog/modalFocus'
import type { ConsentItem } from './consents'

/**
 * 「자세히」 of one consent as a popup, so the consent list itself never moves.
 * 동의·비동의 at the bottom choose and close; the X at the top right (or Esc) only closes.
 */
export function ConsentDialog({
  item,
  value,
  onChoose,
  onClose,
}: {
  item: ConsentItem
  value: boolean | undefined
  onChoose: (agreed: boolean) => void
  onClose: () => void
}) {
  const id = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const modal = useRef<ReturnType<typeof activateModal> | null>(null)

  useLayoutEffect(() => {
    modal.current = dialogRef.current ? activateModal(dialogRef.current, closeRef.current) : null
    return () => modal.current?.close()
  }, [])
  useEffect(() => () => modal.current?.restoreFocus(), [])

  const notice = item.notice
  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog consent-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      onKeyDown={trapTab}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="consent-dialog-head">
        <h2 id={`${id}-title`}>
          {item.title}{' '}
          <span className={`consent-tag${item.required ? ' required' : ''}`}>
            ({item.required ? '필수' : '선택'})
          </span>
        </h2>
        <button ref={closeRef} type="button" className="btn btn-quiet btn-icon consent-dialog-close" aria-label="닫기" onClick={onClose}>
          <X size={18} weight="bold" />
        </button>
      </div>
      {item.note && <p className="fine">{item.note}</p>}
      {notice && (
        <dl className="consent-notice">
          <dt>수집 항목</dt>
          <dd>{notice.items}</dd>
          <dt>목적</dt>
          <dd>{notice.purpose}</dd>
          <dt>보유 기간</dt>
          <dd>{notice.retention}</dd>
          <dt>거부할 권리</dt>
          <dd>{notice.refusal}</dd>
        </dl>
      )}
      <div className="segmented consent-choice consent-dialog-choice" role="group" aria-label={`${item.title} 동의 여부`}>
        <button type="button" aria-pressed={value === true} onClick={() => onChoose(true)}>
          동의
        </button>
        <button type="button" aria-pressed={value === false} onClick={() => onChoose(false)}>
          비동의
        </button>
      </div>
    </dialog>
  )
}
