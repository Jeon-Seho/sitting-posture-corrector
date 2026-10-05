/**
 * Typed access to the Electron preload bridge (frontend/electron/preload.cjs).
 * In a normal browser tab the bridge is absent and every helper reports "not desktop".
 */
export type LaunchInfo = {
  platform: string
  packaged: boolean
  /** The OS started the app from the startup list. */
  launchedAtLogin: boolean
  /** Registering as a startup program needs a packaged build. */
  launchAtLoginSupported: boolean
  launchAtLogin: boolean
  /** Connect the camera automatically when the app was started at login. */
  autoCamera: boolean
}

export type DesktopBridge = {
  version: 1
  platform: string
  getLaunchInfo: () => Promise<LaunchInfo | null>
  setLaunchAtLogin: (enabled: boolean) => Promise<LaunchInfo | null>
  setAutoCamera: (enabled: boolean) => Promise<LaunchInfo | null>
}

declare global {
  interface Window {
    posegoodDesktop?: DesktopBridge
  }
}

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = window.posegoodDesktop
  return bridge && bridge.version === 1 ? bridge : null
}

/**
 * Marks <html> so CSS can reserve the integrated title bar (window buttons + drag strip).
 * `data-desktop` is "win32", "darwin" or "linux"; absent in a normal browser.
 */
export function markDesktopShell() {
  const bridge = desktopBridge()
  if (bridge) document.documentElement.dataset.desktop = bridge.platform
}
