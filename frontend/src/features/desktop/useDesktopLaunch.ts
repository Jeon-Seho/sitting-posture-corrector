import { useCallback, useEffect, useState } from 'react'
import { desktopBridge, type LaunchInfo } from './bridge'

/** Launch settings for the settings screen. `info` stays null outside the desktop app. */
export function useDesktopLaunch() {
  const [info, setInfo] = useState<LaunchInfo | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let alive = true
    desktopBridge()
      ?.getLaunchInfo()
      .then((next) => alive && setInfo(next))
      .catch(() => alive && setMessage('데스크톱 설정을 읽지 못했어요.'))
    return () => {
      alive = false
    }
  }, [])
  const update = useCallback(async (call: () => Promise<LaunchInfo | null> | undefined) => {
    try {
      const next = await call()
      if (next) setInfo(next)
      setMessage('')
    } catch {
      setMessage('데스크톱 설정을 바꾸지 못했어요.')
    }
  }, [])
  return {
    desktop: !!desktopBridge(),
    info,
    message,
    setLaunchAtLogin: (enabled: boolean) => update(() => desktopBridge()?.setLaunchAtLogin(enabled)),
    setAutoCamera: (enabled: boolean) => update(() => desktopBridge()?.setAutoCamera(enabled)),
  }
}
