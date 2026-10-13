import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { ComboChart } from './ComboChart'

const bars = (n: number) => Array.from({ length: n }, (_, i) => ({ label: String(i + 1), value: i % 3 ? 0.5 : null }))

describe('combo chart hover', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => act(() => renderer?.unmount()))

  it('keeps working when a 30-day hover meets a 7-day period', () => {
    act(() => {
      renderer = create(<ComboChart bars={bars(30)} line={bars(30).map(() => 0.1)} barUnit="%" lineUnit="시간" />)
    })
    const chart = () => renderer!.root.findByProps({ role: 'group' })
    // Keyboard ← from nothing selects the last column (index 29).
    act(() => chart().props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} }))
    expect(JSON.stringify(renderer!.toJSON())).toContain('"30"')
    expect(() =>
      act(() => renderer!.update(<ComboChart bars={bars(7)} line={bars(7).map(() => 0.1)} barUnit="%" lineUnit="시간" />)),
    ).not.toThrow()
    expect(renderer!.toJSON()).not.toBeNull()
  })
})
