import { ChartBar, GearSix, Pulse, type Icon } from '@phosphor-icons/react'

/** Internal routes. Several routes share one sidebar tab (see NAV_TABS). */
export type Page =
  | 'home'
  | 'setup'
  | 'session'
  | 'collection'
  | 'dashboard'
  | 'settings'
  | 'profile'

export type Tab = 'measure' | 'records' | 'settings'

/** The desktop app keeps three tabs; preparation, live measurement and results live in "측정하기". */
export const NAV_TABS: { tab: Tab; label: string; icon: Icon }[] = [
  { tab: 'measure', label: '측정하기', icon: Pulse },
  { tab: 'records', label: '기록', icon: ChartBar },
  { tab: 'settings', label: '설정', icon: GearSix },
]

export function tabOf(page: Page): Tab {
  if (page === 'dashboard') return 'records'
  if (page === 'settings' || page === 'profile' || page === 'collection') return 'settings'
  return 'measure'
}

/**
 * `home` is kept as a route name for existing callers ("go home" after finishing or
 * cancelling). In the app it resolves to the measure tab.
 */
export function resolvePage(page: Page, measuring: boolean): Page {
  if (page === 'home') return measuring ? 'session' : 'setup'
  return page
}

export const CAMERA_PAGES: Page[] = ['setup', 'session', 'collection']
