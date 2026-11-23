import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'
import type { LiveState } from './LiveSession'
import { CONNECTING_MIN_MS, CONNECTING_SLOW_MS, ConnectingNotice, connecting, useConnectingNotice } from './LiveSessionPage'

const withObservation = (observation: unknown) => ({ observation }) as unknown as LiveState

describe('connecting notice until the first judgement (11/20)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('covers S1, the socket and the first round trip, not a pause or the end', () => {
    expect(connecting(null, 'creating')).toBe(true)
    expect(connecting(withObservation(undefined), 'connecting')).toBe(true)
    expect(connecting(withObservation(undefined), 'running')).toBe(true)
    expect(connecting(withObservation({ valid: false }), 'running')).toBe(false)
    expect(connecting(withObservation(undefined), 'paused')).toBe(false)
    expect(connecting(withObservation(undefined), 'ending')).toBe(false)
  })

  it('shows the hourglass art and says when it takes long', () => {
    expect(create(<ConnectingNotice open={false} slow={false} />).toJSON()).toBeNull()
    const notice = create(<ConnectingNotice open slow={false} />).root.findByProps({ role: 'status' })
    expect(notice.findByType('img').props.src).toContain('-error-504.webp')
    expect(notice.findByType('strong').children.join('')).toBe('연결하는 중이에요')
    const slow = create(<ConnectingNotice open slow />).root.findByProps({ role: 'status' })
    expect(slow.findByType('strong').children.join('')).toBe('평소보다 오래 걸리고 있어요')
  })

  it('stays at least a second, closes on the result, and turns slow only while waiting', () => {
    let seen = { open: false, slow: false }
    function Probe({ active }: { active: boolean }) {
      seen = useConnectingNotice(active)
      return null
    }
    const tree = create(<Probe active />)
    expect(seen).toEqual({ open: true, slow: false })
    // A fast first result still shows the notice for the minimum time.
    act(() => { vi.advanceTimersByTime(200) })
    act(() => { tree.update(<Probe active={false} />) })
    expect(seen.open).toBe(true)
    act(() => { vi.advanceTimersByTime(CONNECTING_MIN_MS) })
    expect(seen.open).toBe(false)
    // A slow server: the line changes, the notice keeps waiting.
    act(() => { tree.update(<Probe active />) })
    act(() => { vi.advanceTimersByTime(CONNECTING_SLOW_MS) })
    expect(seen).toEqual({ open: true, slow: true })
    act(() => { tree.update(<Probe active={false} />) })
    act(() => { vi.advanceTimersByTime(0) })
    expect(seen).toEqual({ open: false, slow: false })
  })
})
