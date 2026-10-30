import { useEffect, useState } from 'react'
import { CheckCircle, WarningCircle, X } from '../../components/icons'
import { alertPopupText } from './alertPopup'
import { desktopBridge } from './bridge'

type Preview = 'ok' | 'warn' | 'toast' | null

const SHOW_MS = 5000

/**
 * 개발자 옵션 (2026-10-14): show the snackbar, the in-app posture toast and the desktop
 * popup on demand, with the same classes and the same popup window as the real ones, so
 * their look can be checked without waiting for a real alert.
 */
export function AlertPreview() {
  const [shown, setShown] = useState<Preview>(null)
  const [note, setNote] = useState('')
  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => setShown(null), SHOW_MS)
    return () => clearTimeout(timer)
  }, [shown])

  async function popup() {
    const send = desktopBridge()?.showAlert
    if (!send) {
      setNote('앱 밖 알림창은 데스크톱 앱에서만 떠요.')
      setShown('warn')
      return
    }
    await send({ ...alertPopupText(false), preview: true }).catch((caughtError) => {
      console.error('[features/desktop/AlertPreview.tsx:popup] Operation failed', caughtError)
      return null
    })
  }

  return (
    <div className="setting-row setting-row-stack">
      <div>
        <div className="setting-name">알림 모양 확인</div>
        <div className="setting-desc">스낵바, 측정 중 자세 알림, 앱 밖 자세 알림창을 실제와 같은 모양으로 띄워 봐요.</div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="chip" onClick={() => { setNote('저장했어요. 다음 측정부터 적용돼요.'); setShown('ok') }}>
          스낵바 · 확인
        </button>
        <button className="chip" onClick={() => { setNote('설정을 저장하지 못했어요.'); setShown('warn') }}>
          스낵바 · 문제
        </button>
        <button className="chip" onClick={() => setShown('toast')}>
          자세 알림
        </button>
        <button className="chip" onClick={() => void popup()}>
          앱 밖 알림창
        </button>
      </div>
      {(shown === 'ok' || shown === 'warn') && (
        <p role="status" className={`service-notice ${shown === 'warn' ? 'is-warn' : 'is-ok'}`}>
          {shown === 'warn' ? (
            <WarningCircle size={20} weight="fill" className="icon" />
          ) : (
            <CheckCircle size={20} weight="fill" className="icon" />
          )}
          <span>{note}</span>
          <button className="snack-close" aria-label="알림 닫기" onClick={() => setShown(null)}>
            <X size={16} weight="bold" />
          </button>
        </p>
      )}
      {shown === 'toast' && (
        <div className="toast" role="status">
          <WarningCircle size={22} weight="fill" className="icon" />
          <div>
            <div className="alert-title">자세를 확인해 주세요</div>
            <div className="alert-desc">{alertPopupText(false).body}</div>
          </div>
        </div>
      )}
    </div>
  )
}
