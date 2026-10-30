import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { CameraController } from '../../hooks/useCamera'
import { ForecastPage } from '../../pages/ForecastPage'

const controls = vi.hoisted(() => ({ register: vi.fn(), download: vi.fn(), setPredictor: vi.fn() }))
vi.mock('./useForecastExperiment', () => ({ useForecastExperiment: () => ({ ...controls,
  model: { model_id: 'explicit-synthetic-model' }, error: '', predictor: 'lstm', reading: null }) }))
vi.mock('../../components/CameraStage', () => ({ CameraStage: () => <div>synthetic camera view</div> }))
vi.mock('../../components/VisualControls', () => ({ VisualControls: () => null }))
describe('forecast research screen', () => {
  it('does not request camera permission automatically and provides explicit controls', () => {
    const stop = vi.fn(), connect = vi.fn()
    const camera = { stop, connect, state: 'off', videoRef: { current: null }, metrics: { fps: 0 }, error: '' } as unknown as CameraController
    let renderer: ReactTestRenderer
    act(() => { renderer = create(<ForecastPage camera={camera} />) })
    expect(connect).not.toHaveBeenCalled()
    const buttons = renderer!.root.findAllByType('button')
    expect(buttons.find(b => b.children.includes('실험 기준 등록 (8초)'))!.props.disabled).toBe(true)
    act(() => buttons.find(b => b.children.includes('카메라 켜기'))!.props.onClick())
    expect(connect).toHaveBeenCalledOnce()
    act(() => renderer!.update(<ForecastPage camera={{ ...camera, state: 'on' }} />))
    act(() => renderer!.root.findAllByType('button').find(b => b.children.includes('실험 기준 등록 (8초)'))!.props.onClick())
    expect(controls.register).toHaveBeenCalled()
    act(() => renderer!.root.findByType('select').props.onChange({ target: { value: 'hold_last' } }))
    expect(controls.setPredictor).toHaveBeenCalledWith('hold_last')
    act(() => renderer!.unmount())
    expect(stop).toHaveBeenCalled()
  })
})
