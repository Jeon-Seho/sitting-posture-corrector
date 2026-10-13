import { useLayoutEffect, useRef, useState } from 'react'
import { BrandMark } from '../../components/BrandMark'
import type { CameraController } from '../../hooks/useCamera'
import { SetupPage } from '../../pages/SetupPage'

/**
 * Sign-up step 3 (optional). Reuses the registration of 「측정하기」 as is (its 「다시 등록」 mode,
 * which never starts a measurement by itself); the main screens stay with their owner.
 * The width is chosen so the 4:3 camera ends level with the side panel (「이렇게 앉으면 좋아요」 card).
 */
export function SignupPostureStep({
  camera,
  onBack,
  onFinish,
}: {
  camera: CameraController
  onBack: () => void
  onFinish: (registered: boolean) => void
}) {
  const main = useRef<HTMLElement>(null)
  const [panelHeight, setPanelHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const panel = main.current?.querySelector<HTMLElement>('.measure-panel')
    if (!panel || typeof ResizeObserver === 'undefined') return
    const update = () => setPanelHeight(panel.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="signup-posture">
      <header className="signup-posture-head">
        <div className="cover-brand">
          <BrandMark />
          <div>
            <div className="brand-name">PoseGood</div>
            <div className="brand-sub">회원가입 · 3/3 자세 등록 (선택)</div>
          </div>
        </div>
        <p className="fine signup-posture-note">
          지금 등록하지 않아도 돼요. 측정하기에서 등록한 자세가 없으면 그때 3초 동안 등록해요.
        </p>
      </header>
      <main
        ref={main}
        className="signup-posture-main"
        style={panelHeight ? { ['--signup-panel-h' as string]: `${panelHeight}px` } : undefined}
      >
        <SetupPage camera={camera} registerAgain onStart={() => onFinish(true)} onCollect={() => {}} />
      </main>
      <footer className="signup-actions signup-posture-foot">
        <button type="button" className="btn btn-quiet" onClick={onBack}>
          이전
        </button>
        {/* Without a connected camera, skipping is the main way forward. */}
        <button
          type="button"
          className={camera.state === 'on' ? 'btn' : 'btn btn-primary'}
          onClick={() => onFinish(false)}
        >
          {camera.state === 'on' ? '건너뛰기' : '카메라 없이 넘어가기'}
        </button>
      </footer>
    </div>
  )
}
