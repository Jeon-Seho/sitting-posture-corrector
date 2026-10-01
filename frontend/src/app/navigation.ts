import {
  ChartBar,
  Crosshair,
  GearSix,
  House,
  Record,
  Tag,
  UserCircle,
  type Icon,
} from '@phosphor-icons/react'

export type Page =
  | 'home'
  | 'setup'
  | 'session'
  | 'collection'
  | 'dashboard'
  | 'settings'
  | 'profile'

export const NAVIGATION: { page: Page; label: string; icon: Icon }[] = [
  { page: 'home', label: '홈', icon: House },
  { page: 'setup', label: '측정 준비', icon: Crosshair },
  { page: 'session', label: '실시간 측정', icon: Record },
  { page: 'collection', label: '자세 등록', icon: Tag },
  { page: 'dashboard', label: '대시보드', icon: ChartBar },
  { page: 'settings', label: '설정', icon: GearSix },
  { page: 'profile', label: '프로필 설정', icon: UserCircle },
]

export const CAMERA_PAGES: Page[] = ['setup', 'session', 'collection']
export const SUB_TABS: Partial<Record<Page, Page[]>> = {
  session: ['setup', 'session'],
  profile: ['settings', 'profile'],
}
