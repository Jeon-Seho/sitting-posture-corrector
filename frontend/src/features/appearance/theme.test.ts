import { afterEach, expect, it, vi } from 'vitest'
import { contrast, DEFAULT_APPEARANCE, foreground, initializeAppearance, parseAppearance, readableAccent, saveAppearance, APPEARANCE_KEY, THEME_PRESETS, paletteFor } from './theme'
afterEach(() => vi.unstubAllGlobals())
it('rejects damaged and injected values without breaking startup', () => {
  for (const raw of [null, '{', '{"mode":"dark","accent":"url(x)"}', '{"mode":"other","accent":"#123456"}']) expect(parseAppearance(raw)).toEqual(DEFAULT_APPEARANCE)
  expect(parseAppearance('{"mode":"dark","accent":"#ABCDEF"}')).toEqual({ mode: 'dark', accent: '#abcdef' })
})
it('keeps text readable even with black, white, and bright chosen colors', () => {
  for (const color of ['#000000', '#ffffff', '#ffff00', '#00ffff', '#0000ff', '#6750a4', '#18794e']) {
    expect(contrast(color, foreground(color))).toBeGreaterThanOrEqual(4.5)
    for (const bg of ['#ffffff', '#1c242d']) expect(contrast(bg, readableAccent(color, bg))).toBeGreaterThanOrEqual(4.5)
  }
})
it('tracks OS changes only in system mode and reports storage failures', () => {
  const dataset: Record<string, string> = {}
  const style = { setProperty: vi.fn() }
  const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('document', { documentElement: { dataset, style } })
  vi.stubGlobal('window', { matchMedia: () => media, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ mode: 'system', accent: '#123456' }), setItem: vi.fn() })
  const cleanup = initializeAppearance()
  expect(dataset.theme).toBe('light')
  media.matches = true
  media.addEventListener.mock.calls[0][1]()
  expect(dataset.theme).toBe('dark')
  saveAppearance({ mode: 'light', accent: '#abcdef' })
  expect(localStorage.setItem).toHaveBeenCalledWith(APPEARANCE_KEY, JSON.stringify({ mode: 'light', accent: '#abcdef' }))
  media.addEventListener.mock.calls[0][1]()
  expect(dataset.theme).toBe('light')
  vi.mocked(localStorage.setItem).mockImplementation(() => { throw Error('quota') })
  expect(saveAppearance({ mode: 'dark', accent: '#abcdef' })).toBe(false)
  expect(dataset.theme).toBe('dark')
  cleanup()
  expect(media.removeEventListener).toHaveBeenCalledOnce()
})

it('retains the four requested palettes independently from light/dark mode', () => {
  expect(THEME_PRESETS.map(p => p.id)).toEqual(['green', 'peach', 'black', 'discord'])
  expect(paletteFor('#C4532A')?.id).toBe('peach')
  expect(paletteFor('#123456')).toBeUndefined()
  expect(THEME_PRESETS.find(p => p.id === 'black')?.mode).toBe('dark')
  expect(THEME_PRESETS.find(p => p.id === 'discord')?.accent).toBe('#5865f2')
})
