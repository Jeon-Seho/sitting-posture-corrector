import type { FormEvent, ReactNode } from 'react'
import { ArrowRight, BellSimple, LockSimple, Pulse } from '@phosphor-icons/react'
import { BrandMark } from '../components/BrandMark'
import { InlineForm } from '../components/InlineForm'

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
      <section className="cover-hero" aria-label="PoseGood 소개">
        <div className="cover-brand">
          <BrandMark />
          <div>
            <div className="brand-name">PoseGood</div>
            <div className="brand-sub">바른자세 도우미</div>
          </div>
        </div>
        <div>
          <h1>내 편한 자세를 기억해 두고, 흐트러질 때만 살짝 알려드려요</h1>
          <p>카메라로 자세를 살펴보지만 영상은 저장하거나 보내지 않아요.</p>
        </div>
        <SittingArt />
        <div className="cover-points">
          <span>
            <Pulse size={16} weight="bold" />내 기준으로 비교
          </span>
          <span>
            <BellSimple size={16} weight="bold" />
            오래 이어질 때만 알림
          </span>
          <span>
            <LockSimple size={16} weight="bold" />
            영상은 기기 안에서만
          </span>
        </div>
      </section>

      <div className="cover-panel">
        <InlineForm key={title}
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
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={submitDisabled}>
            {submitLabel}
            <ArrowRight size={18} weight="bold" className="icon" />
          </button>
          {fine && <p className="fine">{fine}</p>}
          {footer}
        </InlineForm>
      </div>
    </div>
  )
}

/** Three-quarter rear view of a relaxed seated person: decorative only. */
function SittingArt() {
  return (
    <img className="cover-art" src="/illustrations/login-posture-45.webp"
      alt="" aria-hidden="true" width={360} height={240} draggable={false} />
  )
}
