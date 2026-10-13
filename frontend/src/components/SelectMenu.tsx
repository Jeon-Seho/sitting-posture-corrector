import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { CaretDown, Check } from '@phosphor-icons/react'

export type SelectOption = { value: string; label: string; note?: string }

/**
 * App-styled single choice (2026-10-13): the native <select> opened the operating system's
 * list, which did not match the app. Button + listbox with arrow keys, Enter and Escape.
 */
export function SelectMenu({
  label,
  value,
  options,
  onChange,
  disabled = false,
  icon,
}: {
  /** Accessible name, e.g. "메인 카메라". */
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  icon?: ReactNode
}) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value))
  const [active, setActive] = useState(selectedIndex)
  const current = options[selectedIndex]

  useEffect(() => {
    if (!open) return
    setActive(selectedIndex)
    list.current?.focus()
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
    // Opening resets the highlight to the chosen option.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function choose(index: number) {
    const option = options[index]
    setOpen(false)
    if (option && option.value !== value) onChange(option.value)
  }

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === 'ArrowDown') setActive((i) => Math.min(options.length - 1, i + 1))
    else if (event.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1))
    else if (event.key === 'Home') setActive(0)
    else if (event.key === 'End') setActive(options.length - 1)
    else if (event.key === 'Enter' || event.key === ' ') choose(active)
    else if (event.key === 'Escape' || event.key === 'Tab') setOpen(false)
    else return
    event.preventDefault()
  }

  return (
    <div className={`select-menu ${open ? 'is-open' : ''}`} ref={box}>
      <button
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label}: ${current?.label ?? ''}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {icon}
        <span className="select-current">{current?.label ?? '선택'}</span>
        <CaretDown size={14} weight="bold" className="select-caret" aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          className="select-list"
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${id}-opt-${active}`}
          tabIndex={-1}
          onKeyDown={onListKey}
        >
          {options.map((option, i) => (
            <li
              key={option.value || `option-${i}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === selectedIndex}
              className={`select-option ${i === active ? 'is-active' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span className="select-check" aria-hidden="true">
                {i === selectedIndex && <Check size={14} weight="bold" />}
              </span>
              <span className="select-label">{option.label}</span>
              {option.note && <span className="select-note">{option.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
