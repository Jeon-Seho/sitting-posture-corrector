import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { comparisonDemo } from './comparisonDemo'
import { ObservationOverlay } from './ObservationOverlay'

const sample = (time: number, x: number) => {
  const frame = comparisonDemo(time, 'neutral')
  frame.landmarks[0].x = x
  return frame
}

describe('display-only synthetic observation overlay', () => {
  it('reduces successive point movement without changing source frames or hiding raw loss', () => {
    const first = sample(100, .5), second = sample(200, .51), original = structuredClone(second)
    let ui!: ReactTestRenderer
    act(() => { ui = create(<ObservationOverlay frame={first} />) })
    act(() => { ui.update(<ObservationOverlay frame={second} />) })
    const shownX = ui.root.findAllByType('circle')[0].props.cx / second.width
    expect(shownX).toBeGreaterThan(.5)
    expect(shownX).toBeLessThan(.51)
    expect(second).toEqual(original)
    const missing = sample(300, .7); missing.landmarks[0].visibility = .1
    act(() => { ui.update(<ObservationOverlay frame={missing} />) })
    expect(ui.root.findAllByType('circle')).toHaveLength(6)
    expect(ui.root.findAllByType('line')).toHaveLength(3)
    const found = sample(400, .7)
    act(() => { ui.update(<ObservationOverlay frame={found} />) })
    expect(ui.root.findAllByType('circle')[0].props.cx / found.width).toBe(.7)
    act(() => ui.update(<ObservationOverlay frame={null} />))
    expect(ui.root.findAllByType('svg')).toHaveLength(0)
    const afterGap = sample(900, .3)
    act(() => ui.update(<ObservationOverlay frame={afterGap} />))
    expect(ui.root.findAllByType('circle')[0].props.cx / afterGap.width).toBe(.3)
    act(() => ui.unmount())
  })
})
