import type { ImgHTMLAttributes } from 'react'
import { illustrationPalette, useAppearance } from './theme'

/** Theme-matched illustrations; decorative, never measurement evidence. */
export function ThemeIllustration({ kind, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & { kind: 'login' | 'camera' | 'baseline' | 'empty' | `error-${403 | 404 | 500 | 502 | 503 | 504 | 505}` }) {
  const appearance = useAppearance()
  const palette = illustrationPalette(appearance.accent)
  const path = `/illustrations/themes/${palette}-${kind}.webp`
  const base = typeof window === 'undefined' ? undefined : window.location?.href
  return <img {...props} src={base ? new URL(path, base).href : path} alt="" aria-hidden="true" draggable={false} />
}
