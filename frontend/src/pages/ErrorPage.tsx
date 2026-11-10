import { Component, type ReactNode } from 'react'
import { ThemeIllustration } from '../features/appearance/ThemeIllustration'

export const ERROR_PAGES = {
  403: { title: '이 페이지에 접근할 수 없어요', description: '접근 권한이 있는 계정인지 확인해 주세요.' },
  404: { title: '페이지를 찾을 수 없어요', description: '주소를 확인하거나 홈으로 돌아가 주세요.' },
  500: { title: '화면을 불러오지 못했어요', description: '잠시 뒤 다시 시도해 주세요.' },
  502: { title: '서버 연결이 원활하지 않아요', description: '잠시 뒤 다시 시도해 주세요.' },
  503: { title: '서비스가 잠시 쉬고 있어요', description: '잠시 뒤 다시 방문해 주세요.' },
  504: { title: '서버 응답이 늦어지고 있어요', description: '잠시 뒤 다시 시도해 주세요.' },
  505: { title: '이 연결 방식은 지원하지 않아요', description: '최신 브라우저에서 다시 열어 주세요.' },
} as const
export type ErrorCode = keyof typeof ERROR_PAGES
export function errorCodeForPath(path: string): ErrorCode | null {
  if (path === '/' || /^\/dev\/?$/.test(path)) return null
  const match = /^\/error\/(403|404|500|502|503|504|505)\/?$/.exec(path)
  return match ? Number(match[1]) as ErrorCode : 404
}

export function ErrorPage({ code = 500, onClose }: { code?: ErrorCode; onClose?: () => void }) {
  const content = ERROR_PAGES[code]
  return <main className="error-page" aria-labelledby="error-title">
    <div className="error-content">
      <ThemeIllustration className="error-art" kind={`error-${code}`} width="400" height="300" />
      <p className="error-code">오류 {code}</p>
      <h1 id="error-title">{content.title}</h1>
      <p className="error-description">{content.description}</p>
      <div className="error-actions">
        {onClose ? <button className="btn btn-primary" onClick={onClose}>미리보기 닫기</button> : <>
          <a className="btn btn-primary" href="/">홈으로 돌아가기</a>
          {code !== 403 && code !== 404 && <button className="btn btn-ghost" onClick={() => window.location.reload()}>다시 시도</button>}
        </>}
      </div>
    </div>
  </main>
}

/** A rendering failure must leave recovery controls available without mounting the camera again. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.error('[AppErrorBoundary] Screen rendering failed', error) }
  render() { return this.state.failed ? <ErrorPage code={500} /> : this.props.children }
}
