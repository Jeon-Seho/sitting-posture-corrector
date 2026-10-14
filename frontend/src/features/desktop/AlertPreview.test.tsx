import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlertPreview } from './AlertPreview'

describe('개발자 옵션 알림 모양 확인', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => {
    act(() => renderer?.unmount())
    vi.unstubAllGlobals()
  })
  const press = (label: string) =>
    act(() => renderer!.root.findAll((n) => n.type === 'button' && n.children.join('') === label)[0].props.onClick())
  const has = (className: string) =>
    renderer!.root.findAll((n) => String(n.props.className ?? '').startsWith(className)).length > 0

  it('shows the snackbar kinds and the posture toast with the real classes', () => {
    act(() => {
      renderer = create(<AlertPreview />)
    })
    press('스낵바 · 확인')
    expect(has('service-notice is-ok')).toBe(true)
    press('스낵바 · 문제')
    expect(has('service-notice is-warn')).toBe(true)
    press('자세 알림')
    expect(has('toast')).toBe(true)
  })

  it('asks the desktop shell for a preview popup, or says it needs the desktop app', async () => {
    act(() => {
      renderer = create(<AlertPreview />)
    })
    await act(async () => press('앱 밖 알림창'))
    expect(JSON.stringify(renderer!.toJSON())).toContain('데스크톱 앱에서만 떠요')

    const showAlert = vi.fn(async () => 'popup' as const)
    vi.stubGlobal('window', { posegoodDesktop: { version: 1, showAlert } })
    await act(async () => press('앱 밖 알림창'))
    expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ preview: true }))
  })
})
