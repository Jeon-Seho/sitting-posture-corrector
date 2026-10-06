import { desktopBridge } from './bridge'

/**
 * Invisible drag strip across the top of the desktop window. The OS draws only the
 * window buttons (Windows overlay / macOS traffic lights); the app colours run underneath.
 */
export function TitleBar() {
  if (!desktopBridge()) return null
  return <div className="titlebar-drag" aria-hidden="true" />
}
