import type { ImgHTMLAttributes } from 'react'
import { paletteFor, useAppearance } from './theme'

/** Exact existing illustrations recolored per theme; decorative, never measurement evidence. */
export function ThemeIllustration({ kind, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & { kind: 'login' | 'camera' | 'baseline' | 'empty' }) {
  const appearance = useAppearance()
  const palette = paletteFor(appearance.accent)?.id ?? 'green'
  const path = `/illustrations/themes/${palette}-${kind}.webp`
  const base = typeof window === 'undefined' ? undefined : window.location?.href
  return <img {...props} src={base ? new URL(path, base).href : path} alt="" aria-hidden="true" draggable={false} />
}
