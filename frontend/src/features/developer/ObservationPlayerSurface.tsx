import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

type Props = { hasData: boolean; playing: boolean; children: ReactNode; transport?: ReactNode; footer: ReactNode }
export function ObservationPlayerSurface({ hasData, playing, children, transport, footer }: Props) {
  const [shown, setShown] = useState(true)
  const stage = useRef<HTMLDivElement>(null)
  const settingsOpen = () => !!stage.current?.querySelector('.oc-player-settings[open]')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), keyboardFocus = useRef(false)
  const clear = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null }, [])
  const reveal = useCallback(() => {
    clear(); setShown(true)
    timer.current = setTimeout(() => { if (!keyboardFocus.current && !settingsOpen()) setShown(false) }, 2000)
  }, [clear])
  useEffect(() => {
    if (hasData) reveal()
    return clear
  }, [hasData, playing, reveal, clear])
  useEffect(() => {
    const node = stage.current
    if (!hasData || !node) return
    node.addEventListener('toggle', reveal, true)
    return () => node.removeEventListener('toggle', reveal, true)
  }, [hasData, reveal])
  return <div ref={stage} data-controls-visible={!hasData || shown} className={`oc-replay-stage${hasData ? '' : ' oc-replay-stage-empty'}`} role="group" aria-label="리플레이 플레이어" tabIndex={hasData ? 0 : undefined}
    onPointerMove={hasData ? reveal : undefined} onPointerEnter={hasData ? reveal : undefined}
    onPointerDown={hasData ? () => { keyboardFocus.current = false; reveal() } : undefined}
    onPointerLeave={() => { if (!keyboardFocus.current && !settingsOpen()) { clear(); setShown(false) } }}
    onFocusCapture={event => { keyboardFocus.current = event.target.matches(':focus-visible'); if (hasData) reveal() }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { keyboardFocus.current = false; if (hasData) reveal() } }}>
    {children}
    {hasData && <div className="oc-player-center-controls" data-visible={shown} aria-label="리플레이 재생 제어" aria-hidden={!shown}>{transport}</div>}
    <div className="oc-player-footer" aria-hidden={hasData && !shown}>{footer}</div>
  </div>
}
