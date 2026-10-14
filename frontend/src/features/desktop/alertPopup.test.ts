import { afterEach, describe, expect, it, vi } from 'vitest'
import { alertPopupText, popupAlert } from './alertPopup'

// The test runner has no DOM; a plain object stands in for the page's window.
describe('desktop posture alert popup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses neutral copy without the posture type and marks reminders', () => {
    expect(alertPopupText()).toEqual({
      title: '자세가 흐트러졌어요',
      body: '처음 등록한 편한 자세로 돌아가 볼까요?',
    })
    expect(alertPopupText(true).body).toContain('아직 자세가 돌아오지 않았어요.')
  })

  it('asks the desktop shell to show it and ignores a browser tab or a failure', async () => {
    vi.stubGlobal('window', {})
    expect(() => popupAlert()).not.toThrow()
    const showAlert = vi.fn().mockRejectedValue(new Error('synthetic IPC failure'))
    window.posegoodDesktop = {
      version: 1,
      platform: 'win32',
      getLaunchInfo: vi.fn(),
      setLaunchAtLogin: vi.fn(),
      setAutoCamera: vi.fn(),
      showAlert,
    }
    popupAlert(true)
    expect(showAlert).toHaveBeenCalledWith(alertPopupText(true))
    await Promise.resolve()
  })
})
