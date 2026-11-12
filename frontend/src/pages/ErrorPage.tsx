import { Component, useEffect, type ReactNode, type SyntheticEvent } from 'react'
import { ThemeIllustration } from '../features/appearance/ThemeIllustration'
import { illustrationPalette, useAppearance } from '../features/appearance/theme'
import { KST } from '../lib/kst'

/**
 * Five situations, not one page per HTTP code (frontend README 「오류 안내 페이지」): expected answers such as a
 * wrong password are shown next to the input. The pictures are lellon0403's set (PR #108),
 * reused by meaning; `connecting` lives in the desktop app's `public/offline.html`.
 */
export const ERROR_PAGES = {
  request: { art: 404, title: '요청을 처리하지 못했어요', description: '화면을 새로 고친 뒤 다시 해 주세요.', action: '새로 고침' },
  server: { art: 503, title: '잠시 서버에 문제가 생겼어요', description: '사용자 잘못이 아니에요. 잠시 뒤 다시 시도해 주세요.', action: '다시 시도' },
  offline: { art: 502, title: '인터넷 연결을 확인해 주세요', description: '연결되면 자동으로 다시 불러올게요.', action: '다시 시도' },
  app: { art: 500, title: '화면을 불러오지 못했어요', description: '새로 고치면 대부분 해결돼요.', action: '새로 고침' },
  // 측정하기: the server could not open the measurement (S1 5xx, or Kafka down in kafka mode).
  measure: { art: 500, title: '지금은 측정을 시작할 수 없어요', description: '사용자 잘못이 아니에요. 서버의 측정 기능에 문제가 있어요. 잠시 뒤 다시 시작해 주세요.', action: '다시 준비하기' },
  // 측정 종료: S4 404 — the server has neither the running measurement nor a stored result. The record stays on this device.
  result: { art: 404, title: '서버에서 이번 측정을 찾지 못했어요', description: '사용자 잘못이 아니에요. 측정 결과는 이 기기에 보관해 두었어요. 서버에서 확인되면 기록에 자동으로 반영돼요.', action: '다시 준비하기' },
  not_found: { art: 404, title: '페이지를 찾을 수 없어요', description: '주소를 확인하거나 홈으로 돌아가 주세요.', action: null },
} as const
export type ErrorKind = keyof typeof ERROR_PAGES

/** `/error/<kind>` previews a page; any other unknown path is the not-found page. */
export function errorKindForPath(path: string): ErrorKind | null {
  if (path === '/' || /^\/dev\/?$/.test(path)) return null
  const match = /^\/error\/(request|server|offline|app)\/?$/.exec(path)
  return match ? match[1] as ErrorKind : 'not_found'
}

const stamp = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
function errorStamp(status: number | null | undefined, at: number | undefined) {
  if (at === undefined) return status ? `오류 ${status}` : ''
  const part = (type: string) => stamp.formatToParts(at).find(p => p.type === type)?.value ?? ''
  const time = `${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`
  return status ? `오류 ${status} · ${time}` : time
}

type Props = {
  kind?: ErrorKind
  /** Inside the signed-in shell: the menu stays and only the content area changes (원칙 5). */
  inline?: boolean
  status?: number | null
  at?: number
  /** Only for errors on the 기록 screens (3장 「기록 안전 문구」). */
  recordsSafe?: boolean
  /** Reloads the failed data; without it the button reloads the whole page. */
  onRetry?: () => void
  /** Developer preview only. */
  onClose?: () => void
}

export function ErrorPage({ kind = 'app', inline = false, status, at, recordsSafe = false, onRetry, onClose }: Props) {
  const content = ERROR_PAGES[kind]
  const code = kind === 'request' || kind === 'server' ? errorStamp(status, at) : ''
  return <main className={`error-page${inline ? ' is-inline' : ''}`} aria-labelledby="error-title">
    <div className="error-content">
      <ThemeIllustration className="error-art" kind={`error-${content.art}`} width="400" height="300" onError={hideArt} />
      <h1 id="error-title">{content.title}</h1>
      <p className="error-description">{content.description}</p>
      {recordsSafe && kind === 'server' && <p className="error-description">측정한 기록은 저장돼 있어요.</p>}
      <div className="error-actions">
        {onClose ? <button className="btn btn-primary" onClick={onClose}>미리보기 닫기</button>
          : content.action ? <button className="btn btn-primary" onClick={() => onRetry ? onRetry() : window.location.reload()}>{content.action}</button>
            : <a className="btn btn-primary" href="/">홈으로 돌아가기</a>}
      </div>
      {code && <p className="error-code">{code}</p>}
    </div>
  </main>
}

/** A picture that could not load leaves no broken frame; the words carry the page. */
function hideArt(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = 'none'
}

const kept = new Map<string, HTMLImageElement>()
/**
 * Without a network the offline page cannot fetch its own picture, so it is fetched while still
 * online. Keeping the element lets the browser reuse the decoded image in this document.
 */
export function useOfflineArt(enabled: boolean) {
  const palette = illustrationPalette(useAppearance().accent)
  useEffect(() => {
    if (!enabled || typeof Image === 'undefined' || typeof window === 'undefined' || !window.location?.href) return
    const src = new URL(`/illustrations/themes/${palette}-error-${ERROR_PAGES.offline.art}.webp`, window.location.href).href
    if (kept.has(src)) return
    const image = new Image()
    image.src = src
    kept.set(src, image)
  }, [enabled, palette])
}

/** A rendering failure must leave recovery controls available without mounting the camera again. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.error('[AppErrorBoundary] Screen rendering failed', error) }
  render() { return this.state.failed ? <ErrorPage kind="app" /> : this.props.children }
}
