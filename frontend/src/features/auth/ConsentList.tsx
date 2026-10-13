import { useState } from 'react'
import { CONSENTS, allAgreed, type ConsentChoices, type ConsentItem } from './consents'

/** Sign-up step 1. Nothing starts selected; every row needs its own choice. */
export function ConsentList({
  choices,
  onChange,
}: {
  choices: ConsentChoices
  onChange: (next: ConsentChoices) => void
}) {
  const everyAgreed = CONSENTS.every((item) => choices[item.id] === true)
  return (
    <div className="consent-list">
      <button
        type="button"
        className="btn btn-block consent-all"
        aria-pressed={everyAgreed}
        onClick={() => onChange(allAgreed())}
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
  const [open, setOpen] = useState(false)
  const detailsId = `consent-${item.id}-details`
  return (
    <div className={`consent-row${item.id === 'C4' ? ' consent-row-strong' : ''}`} data-consent={item.id}>
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
        <>
          <button
            type="button"
            className="btn btn-quiet btn-sm consent-more"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen(!open)}
          >
            {open ? '접기' : '자세히'}
          </button>
          {open && (
            <dl className="consent-notice" id={detailsId}>
              <dt>수집 항목</dt>
              <dd>{item.notice.items}</dd>
              <dt>목적</dt>
              <dd>{item.notice.purpose}</dd>
              <dt>보유 기간</dt>
              <dd>{item.notice.retention}</dd>
              <dt>거부할 권리</dt>
              <dd>{item.notice.refusal}</dd>
            </dl>
          )}
        </>
      )}
      {item.required && value === false && (
        <p className="fine consent-warning" role="alert">
          필수 항목이라 동의해야 가입할 수 있어요.
        </p>
      )}
    </div>
  )
}
