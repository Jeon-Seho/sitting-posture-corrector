import { CalendarDots, ChartBar, DeveloperCode, GearSix, Pulse, type Icon } from '../components/icons'

/** Internal routes. Several routes share one sidebar tab (see NAV_TABS). */
export type Page =
  | 'home'
  | 'setup'
  | 'posture'
  | 'session'
  | 'collection'
  | 'dashboard'
  | 'calendar'
  | 'settings'
  | 'profile'
  | 'developer'

export type Tab = 'measure' | 'records' | 'calendar' | 'settings' | 'developer'

/**
 * Preparation, posture registration, live measurement and results live in "측정하기"
 * (2026-10-13: one flow again). Without a registered posture it registers first and then
 * measures; with one it measures at once. `posture` is the "register again" route.
 * 기록 shows today; 달력 picks any other day (2026-10-13 split).
 */
export const NAV_TABS: { tab: Tab; label: string; icon: Icon }[] = [
  { tab: 'measure', label: '측정하기', icon: Pulse },
  { tab: 'records', label: '오늘', icon: ChartBar },
  { tab: 'calendar', label: '기록', icon: CalendarDots },
  { tab: 'settings', label: '설정', icon: GearSix },
  { tab: 'developer', label: '개발자 도구', icon: DeveloperCode },
]

export function tabOf(page: Page): Tab {
  if (page === 'developer') return 'developer'
  if (page === 'dashboard') return 'records'
  if (page === 'calendar') return 'calendar'
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

export const CAMERA_PAGES: Page[] = ['setup', 'posture', 'session', 'collection']
