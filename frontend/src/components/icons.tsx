import type { ComponentType, HTMLAttributes } from 'react'

type IconProps = HTMLAttributes<HTMLSpanElement> & {
  size?: number | string
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
  mirrored?: boolean
  color?: string
}
export type Icon = ComponentType<IconProps>

/** Raster icons cut from one AI-generated flat emoji sheet; button labels remain accessible. */
function asset(id: string): Icon {
  return function PoseGoodIcon({ size = 24, weight: _weight, mirrored, style, color, className = '', ...props }: IconProps) {
    const labelled = !!(props['aria-label'] || props['aria-labelledby'])
    // The module stays in the main realm when rendering the native about:blank portal.
    const base = typeof window === 'undefined' ? undefined : window.location?.href
    const source = base ? new URL(`/icons/${id}.png`, base).href : `/icons/${id}.png`
    return (
      <span aria-hidden={labelled ? undefined : true} role={labelled ? 'img' : undefined} {...props}
        className={`posegood-icon ${className}`}
        style={{ display: 'inline-flex', flexShrink: 0, width: size, height: size, verticalAlign: 'middle', color, ...style, ...(mirrored ? { transform: 'scaleX(-1)' } : {}) }}>
        <img src={source} alt="" draggable={false} width={size} height={size}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
      </span>
    )
  }
}

export const Pulse = asset('pulse')
export const ChartBar = asset('chart-bar')
export const CalendarDots = asset('calendar-dots')
export const GearSix = asset('gear-six')
export const VideoCamera = asset('video-camera')
export const Clock = asset('clock')
export const Timer = asset('timer')
export const ClockCounterClockwise = asset('clock-counter-clockwise')
export const Bell = asset('bell')
export const BellSlash = asset('bell-slash')
export const SlidersHorizontal = asset('sliders-horizontal')
export const Power = asset('power')
export const Person = asset('person')
export const UserCircle = asset('user-circle')
export const SignOut = asset('sign-out')
export const Play = asset('play')
export const Pause = asset('pause')
export const Square = asset('square')
export const Stop = asset('stop')
export const FastForward = asset('fast-forward')
export const ArrowLeft = asset('arrow-left')
export const ArrowRight = asset('arrow-right')
export const CaretLeft = asset('caret-left')
export const CaretRight = asset('caret-right')
export const CaretUp = asset('caret-up')
export const CaretDown = asset('caret-down')
export const Minus = asset('minus')
export const X = asset('x')
export const Check = asset('check')
export const CheckCircle = asset('check-circle')
export const WarningCircle = asset('warning-circle')
export const Info = asset('info')
export const Question = asset('question')
export const ArrowClockwise = asset('arrow-clockwise')
export const ArrowCounterClockwise = asset('arrow-counter-clockwise')
export const ArrowsClockwise = asset('arrows-clockwise')
export const ArrowsOutSimple = asset('arrows-out-simple')
export const Hourglass = asset('hourglass')
export const Database = asset('database')
export const LockSimple = asset('lock-simple')
export const SpeakerHigh = asset('speaker-high')
export const SpeakerSlash = asset('speaker-slash')
export const WifiSlash = asset('wifi-slash')
