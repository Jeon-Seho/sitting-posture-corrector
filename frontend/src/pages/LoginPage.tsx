import type { FormEvent, ReactNode } from 'react'
import { Armchair, ArrowRight, BellSimple, LockSimple, Pulse } from '@phosphor-icons/react'

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
          <span className="brand-mark" aria-hidden="true">
            <Armchair size={22} weight="bold" />
          </span>
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
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={submitDisabled}>
            {submitLabel}
            <ArrowRight size={18} weight="bold" className="icon" />
          </button>
          {fine && <p className="fine">{fine}</p>}
          {footer}
        </form>
      </div>
    </div>
  )
}

/** Simple seated figure at a desk: decorative only. */
function SittingArt() {
  return (
    <svg className="cover-art" viewBox="0 0 360 240" aria-hidden="true">
      <rect x="20" y="206" width="320" height="10" rx="5" fill="#f4d2be" />
      <path d="M96 100 V206" stroke="#c4532a" strokeWidth="10" strokeLinecap="round" />
      <path d="M96 176 H168 M160 176 V206" stroke="#c4532a" strokeWidth="10" strokeLinecap="round" />
      <rect x="208" y="112" width="112" height="76" rx="10" fill="#fffaf4" stroke="#e2d3c3" strokeWidth="3" />
      <rect x="250" y="188" width="28" height="18" rx="3" fill="#e2d3c3" />
      <circle cx="264" cy="150" r="10" fill="#7fbf8e" />
      <rect x="112" y="96" width="50" height="84" rx="24" fill="#3f7d52" />
      <path d="M150 116 Q176 140 206 152" fill="none" stroke="#3f7d52" strokeWidth="13" strokeLinecap="round" />
      <path d="M130 172 H190 V206" fill="none" stroke="#2e241f" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="137" cy="70" r="21" fill="#7a5b49" />
      <path d="M116 68 Q118 45 139 45 Q158 47 158 66 Q148 56 137 56 Q125 56 116 68 Z" fill="#2e241f" />
      <path d="M137 102 V168" stroke="#fff8f0" strokeWidth="3" strokeDasharray="5 6" strokeLinecap="round" opacity="0.8" />
    </svg>
  )
}
