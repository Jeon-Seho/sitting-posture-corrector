import type { FormEvent, ReactNode } from 'react'
import { ArrowRight } from '@phosphor-icons/react'
import { Rings } from '../components/ui'

export function LoginPage({
  title,
  lead,
  submitLabel,
  fine,
  onSubmit,
  children,
  footer,
  submitDisabled = false,
}: {
  title: string
  lead: string
  submitLabel: string
  fine?: ReactNode
  onSubmit: () => void
  children: ReactNode
  footer?: ReactNode
  submitDisabled?: boolean
}) {
  return (
    <div className="cover-page">
      <div className="cover">
        <Rings count={3} />
        <div className="cover-sheet">
          <div className="cover-meta">
            <div className="cover-dash">
              <span>자세 붕괴 주기 분석</span>
              <span>교정 보조 시스템</span>
            </div>

            <form
              className="cover-form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                onSubmit()
              }}
            >
              <div>
                <h2>{title}</h2>
                <p className="lead">{lead}</p>
              </div>

              {children}

              <button
                type="submit"
                className="btn btn-lg"
                disabled={submitDisabled}
                style={{ width: '100%' }}
              >
                {submitLabel}
                <ArrowRight size={18} weight="bold" className="icon" />
              </button>

              {fine && <p className="fine">{fine}</p>}
              {footer}
            </form>
          </div>

          <h1 className="cover-title">
            POSE
            <br />
            GOOD
          </h1>
        </div>
      </div>
    </div>
  )
}
