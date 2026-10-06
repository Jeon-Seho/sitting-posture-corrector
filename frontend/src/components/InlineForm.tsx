import { createContext, useContext, useId, useState, type FormHTMLAttributes, type InputHTMLAttributes } from 'react'

const ValidationContext = createContext({ errors: {} as Record<string, string>, id: '' })

function fieldError(input: HTMLInputElement): string {
  if (!input.willValidate) return ''
  const label = input.dataset.validationLabel || '내용'
  const v = input.validity
  if (v.badInput) return '숫자로 입력해 주세요.'
  if (v.valueMissing || (input.required && input.type !== 'password' && input.type !== 'checkbox' && !input.value.trim()))
    return input.type === 'checkbox' ? '계정과 측정 기록 보관에 동의해 주세요.' : `${label}${['이름', '직업', '이메일'].includes(label) ? '을' : '를'} 입력해 주세요.`
  if (v.typeMismatch) return '이메일 주소 형식을 확인해 주세요.'
  if (v.rangeUnderflow || v.rangeOverflow) return `${input.min}~${input.max} 사이로 입력해 주세요.`
  if (v.stepMismatch) return '정수로 입력해 주세요.'
  if (v.tooShort) return `${input.minLength}자 이상 입력해 주세요.`
  if (v.tooLong) return `${input.maxLength}자 이하로 입력해 주세요.`
  return v.valid ? '' : `${label} 입력을 확인해 주세요.`
}

/** Preserve HTML constraints while replacing browser validation bubbles with inline feedback. */
export function InlineForm({ onSubmit, onChangeCapture, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const id = useId()
  return <ValidationContext.Provider value={{ errors, id }}>
    <form {...props} noValidate onSubmit={(event) => {
      event.preventDefault()
      const next: Record<string, string> = {}
      let first: HTMLInputElement | undefined
      for (const element of Array.from(event.currentTarget.elements)) {
        if (!(element instanceof HTMLInputElement)) continue
        const message = fieldError(element)
        if (message) {
          next[element.name] = message
          first ??= element
        }
      }
      setErrors(next)
      if (first) first.focus()
      else onSubmit?.(event)
    }} onChangeCapture={(event) => {
      const input = event.target
      if (input instanceof HTMLInputElement && errors[input.name]) {
        const message = fieldError(input)
        setErrors((previous) => {
          const next = { ...previous }
          if (message) next[input.name] = message
          else delete next[input.name]
          return next
        })
      }
      onChangeCapture?.(event)
    }} />
  </ValidationContext.Provider>
}

export function FieldWarning({ name }: { name: string }) {
  const { errors, id } = useContext(ValidationContext)
  return errors[name] ? (
    <small id={`${id}-${name}`} className="field-warning" role="alert">{errors[name]}</small>
  ) : null
}

export function ValidatedInput({ name, validationLabel, ...props }: InputHTMLAttributes<HTMLInputElement> & { name: string; validationLabel: string }) {
  const { errors, id } = useContext(ValidationContext)
  const describedBy = [props['aria-describedby'], errors[name] ? `${id}-${name}` : ''].filter(Boolean).join(' ') || undefined
  return <>
    <input {...props} name={name} data-validation-label={validationLabel}
      aria-label={props['aria-label'] ?? (props.type === 'checkbox' ? undefined : validationLabel)}
      aria-invalid={errors[name] ? true : undefined} aria-describedby={describedBy} />
    {props.type !== 'checkbox' && <FieldWarning name={name} />}
  </>
}
