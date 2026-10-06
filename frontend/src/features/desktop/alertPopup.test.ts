import { afterEach, describe, expect, it, vi } from 'vitest'
import { alertPopupText, popupAlert } from './alertPopup'

// The test runner has no DOM; a plain object stands in for the page's window.
describe('desktop posture alert popup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the measurement screen copy and marks reminders', () => {
    expect(alertPopupText('tilt')).toEqual({
      title: '몸이 한쪽으로 기울었어요',
      body: '천천히 양쪽 어깨 높이를 맞춰 볼까요?',
    })
    expect(alertPopupText('forwardHead', true).body).toBe(
      '아직 자세가 돌아오지 않았어요. 턱을 살짝 당기고 등을 의자에 기대 볼까요?',
    )
    expect(alertPopupText(null).title).toBe('자세가 흐트러졌어요')
  })

  it('asks the desktop shell to show it and ignores a browser tab or a failure', async () => {
    vi.stubGlobal('window', {})
    expect(() => popupAlert('tilt')).not.toThrow()
    const showAlert = vi.fn().mockRejectedValue(new Error('synthetic IPC failure'))
    window.posegoodDesktop = {
      version: 1,
      platform: 'win32',
      getLaunchInfo: vi.fn(),
      setLaunchAtLogin: vi.fn(),
      setAutoCamera: vi.fn(),
      showAlert,
    }
    popupAlert('referenceChange', true)
    expect(showAlert).toHaveBeenCalledWith({
      title: '기준 자세와 달라졌어요',
      body: '아직 자세가 돌아오지 않았어요. 처음 등록한 편한 자세로 돌아가 볼까요?',
    })
    await Promise.resolve()
  })
})
