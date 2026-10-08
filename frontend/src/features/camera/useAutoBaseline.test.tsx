import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { CameraController } from '../../hooks/useCamera'
import { AUTO_CALIBRATE_DELAY_MS, useAutoBaseline } from './useAutoBaseline'

// Explicitly synthetic camera state; no media devices or landmarks.
type State = Pick<CameraController, 'state' | 'quality' | 'baseline' | 'progress'>
const baseline = { headGap: 0.4, offset: 0, tilt: 0, quality: 0.9 }

describe('automatic baseline and measurement start', () => {
  let state: State
  let calibrate: Mock<() => void>
  let cancelCalibration: Mock<() => void>
  let onStart: Mock<() => void>
  let controls: ReturnType<typeof useAutoBaseline>
  let renderer: ReactTestRenderer

  function Probe() {
    controls = useAutoBaseline({ ...state, calibrate, cancelCalibration } as unknown as CameraController, onStart)
    return null
  }
  const render = (patch: Partial<State>) => {
    state = { ...state, ...patch }
    act(() => renderer.update(<Probe />))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    state = { state: 'on', quality: false, baseline: null, progress: null }
    calibrate = vi.fn<() => void>()
    cancelCalibration = vi.fn<() => void>()
    onStart = vi.fn<() => void>()
    act(() => {
      renderer = create(<Probe />)
    })
  })
  afterEach(() => vi.useRealTimers())

  it('calibrates once the person stays visible, then starts measuring', () => {
    render({ quality: true })
    act(() => {
      vi.advanceTimersByTime(AUTO_CALIBRATE_DELAY_MS - 1)
    })
    expect(calibrate).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(calibrate).toHaveBeenCalledOnce()
    render({ progress: 0.4 })
    expect(onStart).not.toHaveBeenCalled()
    render({ progress: null, baseline })
    expect(onStart).toHaveBeenCalledOnce()
    render({ quality: false })
    render({ quality: true })
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('waits while the person is not steadily visible', () => {
    render({ quality: true })
    act(() => {
      vi.advanceTimersByTime(AUTO_CALIBRATE_DELAY_MS / 2)
    })
    render({ quality: false })
    act(() => {
      vi.advanceTimersByTime(AUTO_CALIBRATE_DELAY_MS)
    })
    expect(calibrate).not.toHaveBeenCalled()
  })

  it('never starts from an older baseline and stops auto-calibrating after a cancel', () => {
    render({ quality: true, baseline })
    act(() => {
      vi.advanceTimersByTime(AUTO_CALIBRATE_DELAY_MS * 2)
    })
    expect(calibrate).not.toHaveBeenCalled()
    expect(onStart).not.toHaveBeenCalled()

    render({ baseline: null })
    act(() => {
      vi.advanceTimersByTime(AUTO_CALIBRATE_DELAY_MS)
    })
    render({ progress: 0.2 })
    act(() => controls.cancel())
    expect(cancelCalibration).toHaveBeenCalledOnce()
    render({ progress: null })
    act(() => {
      vi.advanceTimersByTime(AUTO_CALIBRATE_DELAY_MS * 2)
    })
    expect(calibrate).toHaveBeenCalledOnce()
    expect(onStart).not.toHaveBeenCalled()

    act(() => controls.calibrate())
    expect(calibrate).toHaveBeenCalledTimes(2)
    render({ progress: 0.5 })
    render({ progress: null, baseline })
    expect(onStart).toHaveBeenCalledOnce()
  })
})
