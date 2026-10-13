import { useSyncExternalStore } from 'react'
import { desktopBridge } from '../desktop/bridge'

/**
 * Losing the server connection ends the session (user decision 2026-10-13). The app does not
 * reconnect or resend. One app-wide signal blocks the screen until the user quits the app.
 */
export type ConnectionLoss = {
  reason: 'network' | 'realtime' | 'test'
  /** "2026-10-13 · 세션 2" when a measurement session was running. */
  session?: string
}

let current: ConnectionLoss | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

/** The first loss wins; later reports while the dialog is open change nothing. */
export function reportConnectionLost(loss: ConnectionLoss) {
  if (current) return
  current = { ...loss }
  notify()
}

export function connectionLost(): ConnectionLoss | null {
  return current
}

export function subscribeConnectionLost(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useConnectionLost() {
  return useSyncExternalStore(subscribeConnectionLost, connectionLost, connectionLost)
}

/** Tests only: there is no in-app way back from a lost connection. */
export function resetConnectionLost() {
  current = null
  notify()
}

/**
 * Closes the desktop app. A browser tab can only close itself when a script opened it,
 * so `false` means the user has to close the tab.
 */
export async function quitApp(): Promise<boolean> {
  const quit = desktopBridge()?.quit
  if (quit) {
    try {
      if (await quit()) return true
    } catch {
      /* Fall through to the browser path. */
    }
  }
  window.close()
  return window.closed
}
