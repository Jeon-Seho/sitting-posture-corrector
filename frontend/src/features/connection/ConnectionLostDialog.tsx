import { useId, useLayoutEffect, useRef, useState } from 'react'
import { WifiSlash } from '@phosphor-icons/react'
import { trapTab } from '../dialog/modalFocus'
import { quitApp, useConnectionLost } from './connectionLost'

/** App-wide and blocking: no cancel, Escape or backdrop close. The only way on is quitting. */
export function ConnectionLostDialog() {
  const loss = useConnectionLost()
  return loss ? <LostDialog session={loss.session} test={loss.reason === 'test'} /> : null
}

function LostDialog({ session, test }: { session?: string; test: boolean }) {
  const id = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const quitRef = useRef<HTMLButtonElement>(null)
  const [quitting, setQuitting] = useState(false)
  const [stillOpen, setStillOpen] = useState(false)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    quitRef.current?.focus()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [])

  async function quit() {
    if (quitting) return
    setQuitting(true)
    const closed = await quitApp()
    if (!closed) {
      setQuitting(false)
      setStillOpen(true)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="connection-lost"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      tabIndex={-1}
      onKeyDown={trapTab}
      onCancel={(event) => event.preventDefault()}
    >
      <span className="connection-lost-icon" aria-hidden="true">
        <WifiSlash size={28} weight="bold" />
      </span>
      <h2 id={`${id}-title`}>서버와의 연결이 불안정합니다</h2>
      <div id={`${id}-description`}>
        <p>재접속 후 다시 시도해 주세요.</p>
        {session && <p className="fine">{session} 측정은 여기서 종료했어요.</p>}
        {test && <p className="fine">개발 확인용으로 띄운 화면이에요.</p>}
      </div>
      {stillOpen && (
        <p role="alert" className="fine">
          브라우저에서는 앱이 탭을 닫을 수 없어요. 이 탭을 직접 닫아 주세요.
        </p>
      )}
      <button
        ref={quitRef}
        type="button"
        className="btn btn-primary btn-lg"
        disabled={quitting}
        onClick={() => void quit()}
      >
        {quitting ? '종료하는 중…' : '종료하기'}
      </button>
    </dialog>
  )
}
