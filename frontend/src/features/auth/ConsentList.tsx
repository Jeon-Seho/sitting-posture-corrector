import { useRef, useState } from 'react'
import { CONSENTS, allAgreed, type ConsentChoices, type ConsentItem } from './consents'
import { ConsentDialog } from './ConsentDialog'

/** Sign-up step 1. Nothing starts selected; every row needs its own choice. */
export function ConsentList({
  choices,
  onChange,
}: {
  choices: ConsentChoices
  onChange: (next: ConsentChoices) => void
}) {
  const everyAgreed = CONSENTS.every((item) => choices[item.id] === true)
  const allButton = useRef<HTMLButtonElement>(null)
  return (
    <div className="consent-list">
      <button
        type="button"
        className="btn btn-block consent-all"
        aria-pressed={everyAgreed}
        ref={allButton}
        onClick={() => {
          // 전체 동의 then jumps to 「다음」 so nobody has to scroll down for it (user, 2026-10-14).
          const form = allButton.current?.closest('form')
          onChange(allAgreed())
          if (!form) return
          // The submit button is enabled only after the re-render, so wait a frame.
          requestAnimationFrame(() => {
            const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')
            if (!submit) return
            submit.focus({ preventScroll: true })
            revealBelow(submit, 24)
          })
        }}
      >
        전체 동의
      </button>
      {CONSENTS.map((item) => (
        <ConsentRow
          key={item.id}
          item={item}
          value={choices[item.id]}
          onChange={(agreed) => onChange({ ...choices, [item.id]: agreed })}
        />
      ))}
    </div>
  )
}

function ConsentRow({
  item,
  value,
  onChange,
}: {
  item: ConsentItem
  value: boolean | undefined
  onChange: (agreed: boolean) => void
}) {
  // 「자세히」 opens a popup instead of expanding the row, so the list never shifts (user, 2026-10-13).
  const [open, setOpen] = useState(false)
  return (
    <div className="consent-row" data-consent={item.id}>
      <div className="consent-head">
        <div className="consent-title">
          {item.title}{' '}
          <span className={`consent-tag${item.required ? ' required' : ''}`}>
            ({item.required ? '필수' : '선택'})
          </span>
        </div>
        <div className="segmented consent-choice" role="group" aria-label={`${item.title} 동의 여부`}>
          <button type="button" aria-pressed={value === true} onClick={() => onChange(true)}>
            동의
          </button>
          <button type="button" aria-pressed={value === false} onClick={() => onChange(false)}>
            비동의
          </button>
        </div>
      </div>
      {item.note && <p className="fine">{item.note}</p>}
      {item.notice && (
        <button
          type="button"
          className="btn btn-quiet btn-sm consent-more"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          자세히
        </button>
      )}
      {open && (
        <ConsentDialog
          item={item}
          value={value}
          onChoose={(agreed) => {
            onChange(agreed)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
      {item.required && value === false && (
        <p className="fine consent-warning" role="alert">
          필수 항목이라 동의해야 가입할 수 있어요.
        </p>
      )}
    </div>
  )
}

/**
 * Scrolls just far enough that `element` sits `margin` px above the bottom of its scroller.
 * Done by hand because `scrollIntoView` did not move the page in the desktop app.
 */
function revealBelow(element: HTMLElement, margin: number) {
  let container: HTMLElement | null = element.parentElement
  while (container) {
    const { overflowY } = getComputedStyle(container)
    if (/(auto|scroll)/.test(overflowY) && container.scrollHeight > container.clientHeight) break
    container = container.parentElement
  }
  const viewBottom = container ? container.getBoundingClientRect().bottom : window.innerHeight
  const amount = element.getBoundingClientRect().bottom + margin - viewBottom
  if (amount <= 0) return
  const behavior: ScrollBehavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'
  if (container) container.scrollBy({ top: amount, behavior })
  else window.scrollBy({ top: amount, behavior })
}
