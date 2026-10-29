import { useSyncExternalStore } from 'react'
import { desktopBridge } from '../desktop/bridge'
import { updateDesktopIcon } from './desktopIcon'

export type Appearance = { mode: 'system' | 'light' | 'gray' | 'dark'; accent: string }
export const DEFAULT_APPEARANCE: Appearance = { mode: 'system', accent: '#18794e' }
export const APPEARANCE_KEY = 'posegood.appearance.v1'
export const THEME_PRESETS = [
  { id: 'green', name: '초록', accent: '#18794e', brand: '#416b56', mode: 'light', description: '익숙하고 편안한 초록' },
  { id: 'peach', name: '살구', accent: '#c4532a', brand: '#fdcd95', mode: 'light', description: '포근한 살구빛과 크림 톤' },
  { id: 'blue', name: '오션', accent: '#2864c8', brand: '#254c7f', mode: 'light', description: '시원한 파랑과 맑은 중립 톤' },
  { id: 'teal', name: '틸', accent: '#087f8c', brand: '#255d63', mode: 'light', description: '차분한 청록과 부드러운 회색' },
  { id: 'charcoal', name: '차콜', accent: '#525963', brand: '#34383f', mode: 'gray', description: '담백한 회색과 차콜 포인트' },
  { id: 'black', name: '블랙', accent: '#242424', brand: '#141414', mode: 'dark', description: '차분한 검정과 회색' },
  { id: 'discord', name: '블러플', accent: '#5865f2', brand: '#232428', mode: 'dark', description: '차콜 바탕에 청보라 포인트' },
] as const
export const paletteFor = (accent: string) => THEME_PRESETS.find(p => p.accent === accent.toLowerCase())
export const illustrationPalette = (accent: string) => {
  const id = paletteFor(accent)?.id
  return id === 'blue' || id === 'teal' || id === 'charcoal' ? 'black' : id ?? 'green'
}
export const validColor = (color: string) => /^#[0-9a-f]{6}$/i.test(color)
export function parseAppearance(raw: string | null): Appearance {
  try {
    const value = JSON.parse(raw ?? 'null')
    if (value && ['system', 'light', 'gray', 'dark'].includes(value.mode) && typeof value.accent === 'string' && validColor(value.accent))
      return { mode: value.mode, accent: value.accent.toLowerCase() }
  } catch { /* Invalid preferences must never prevent login. */ }
  return { ...DEFAULT_APPEARANCE }
}
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
export function luminance(hex: string) {
  return rgb(hex).map(n => { const c = n / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
}
export const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
export const foreground = (background: string) => contrast('#ffffff', background) >= contrast('#000000', background) ? '#ffffff' : '#000000'
export function mix(a: string, b: string, amount: number) {
  const other = rgb(b)
  return '#' + rgb(a).map((n, i) => Math.round(n + (other[i] - n) * amount).toString(16).padStart(2, '0')).join('')
}
export function readableAccent(accent: string, background: string, minimum = 4.5) {
  const target = foreground(background)
  for (let i = 0; i <= 100; i++) {
    const next = mix(accent, target, i / 100)
    if (contrast(next, background) >= minimum) return next
  }
  return target
}
let current = DEFAULT_APPEARANCE
let media: MediaQueryList | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())
export function applyAppearance(value: Appearance, systemDark = false) {
  const root = document.documentElement
  const dark = value.mode === 'dark' || (value.mode === 'system' && systemDark)
  const palette = paletteFor(value.accent)
  const tone = dark ? 'dark' : value.mode === 'gray' ? 'gray' : 'light'
  root.dataset.theme = tone
  root.dataset.palette = palette?.id ?? 'custom'
  const bridge = desktopBridge()
  void (bridge?.setAppearanceTone ? bridge.setAppearanceTone(tone) : bridge?.setDarkMode?.(dark))?.catch(() => {})
  const surface = dark ? palette?.id === 'discord' ? '#313338' : palette?.id === 'black' ? '#202020' : '#1c242d' : tone === 'gray' ? '#dfe2e6' : palette?.id === 'peach' ? '#fffaf4' : '#ffffff'
  let chartBar = readableAccent(mix(surface, value.accent, 0.55), surface, 3)
  const initialBar = chartBar
  for (let i = 0; i <= 100; i++) {
    const candidate = mix(initialBar, surface, i / 100)
    if (contrast(candidate, surface) >= 3 && contrast(candidate, foreground(surface)) >= 3) {
      chartBar = candidate
      break
    }
  }
  let chartLine = readableAccent(value.accent, surface)
  // The line crosses the columns, so it also needs contrast against the bar itself.
  for (let i = 0; i <= 100; i++) {
    const candidate = mix(chartLine, foreground(surface), i / 100)
    if (contrast(candidate, surface) >= 4.5 && contrast(candidate, chartBar) >= 3) {
      chartLine = candidate
      break
    }
  }
  const ink = foreground(value.accent)
  updateDesktopIcon(value.accent, ink)
  const snack = mix(surface, value.accent, 0.08)
  const snackInk = foreground(snack)
  const popup = { background: snack, text: snackInk, muted: mix(snackInk, snack, 0.22),
    accent: readableAccent(value.accent, snack), track: mix(snack, snackInk, 0.3), dark: snackInk === '#ffffff' }
  void bridge?.setPopupTheme?.(popup).catch(() => {})
  const tokens: Record<string, string> = {
    '--primary': value.accent, '--on-primary': ink,
    '--logo-bg': value.accent, '--logo-ink': ink,
    '--snack': snack, '--snack-ink': snackInk, '--snack-muted': popup.muted,
    '--snack-good': readableAccent('#238653', snack), '--snack-warn': readableAccent('#8c651f', snack), '--snack-bad': readableAccent('#b44b55', snack),
    '--primary-press': mix(value.accent, ink === '#ffffff' ? '#000000' : '#ffffff', 0.12),
    '--primary-ink': readableAccent(value.accent, surface),
    '--primary-tint': mix(surface, value.accent, dark ? 0.18 : 0.09),
    '--primary-soft': chartBar,
    '--chart-bar': chartBar, '--chart-line': chartLine,
    '--brand': palette?.brand ?? mix(value.accent, '#000000', 0.25),
  }
  tokens['--on-brand'] = foreground(tokens['--brand'])
  tokens['--on-primary-filter'] = ink === '#000000' ? 'grayscale(1) brightness(0)' : 'grayscale(1) brightness(0) invert(1)'
  tokens['--on-brand-filter'] = tokens['--on-brand'] === '#000000' ? 'grayscale(1) brightness(0)' : 'grayscale(1) brightness(0) invert(1)'
  for (const [name, color] of Object.entries(tokens)) root.style.setProperty(name, color)
}
export function initializeAppearance() {
  try { current = parseAppearance(localStorage.getItem(APPEARANCE_KEY)) } catch { current = DEFAULT_APPEARANCE }
  media = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => applyAppearance(current, media?.matches)
  const storage = (event: StorageEvent) => {
    if (event.key !== APPEARANCE_KEY && event.key !== null) return
    current = parseAppearance(event.newValue); apply(); emit()
  }
  apply()
  media.addEventListener('change', apply)
  window.addEventListener('storage', storage)
  return () => { media?.removeEventListener('change', apply); window.removeEventListener('storage', storage) }
}
export function saveAppearance(next: Appearance) {
  if (!validColor(next.accent) || !['system', 'light', 'gray', 'dark'].includes(next.mode)) return false
  current = { ...next, accent: next.accent.toLowerCase() }
  applyAppearance(current, media?.matches)
  emit()
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(current)); return true } catch { return false }
}
export const useAppearance = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => current, () => DEFAULT_APPEARANCE)
