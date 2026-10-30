import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObservationReplay } from './ObservationReplayPanel'
import { SelectMenu } from '../../components/SelectMenu'
import { ObservationMetrics } from './ObservationMetrics'
import { ReplayImportDialog } from './ReplayImportDialog'
import { ObservationReplayArchive, downloadObservationReplay, type ReplayContext } from './observationReplay'
import { changedFrame } from './syntheticChanges.test-utils'
vi.mock('./observationReplay', async original => ({ ...await original<typeof import('./observationReplay')>(), downloadObservationReplay: vi.fn() }))
const context: ReplayContext = { phase: 'hold', task: 'deviation', round: 1, trial: 1, attempt: 1, segment: 1, measurement: true }
const data = () => { const a = new ObservationReplayArchive('synthetic-replay-ui', '2026-10-21T00:00:00.000Z'); for(let i=0;i<=10;i++) a.append(changedFrame(i*100,'head'),i*100,context); return { ...a.snapshot(), source: 'synthetic' as const } }
describe('isolated keypoint player', () => {
  let ui: ReactTestRenderer, doc: EventTarget & { visibilityState: string }
  const getRecording = vi.fn(data)
  const props = () => ({ visible: true, active: false, count: 11, dropped: 0, getRecording })
  const button = (label: string) => ui.root.findAllByType('button').find(b => (b.props['aria-label'] ?? b.props.children) === label)!
  const position = () => ui.root.findByProps({ 'aria-label': '리플레이 위치' })
  beforeEach(() => { vi.useFakeTimers(); doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }); vi.stubGlobal('document',doc); vi.clearAllMocks(); act(() => { ui = create(<ObservationReplay {...props()} />) }) })
  afterEach(() => { act(() => ui.unmount()); vi.useRealTimers(); vi.unstubAllGlobals() })
  it('plays at selected speed, seeks without changing source data and stops at the end', () => {
    expect(ui.root.findAllByType('video')).toHaveLength(0)
    const badge = ui.root.findByProps({ className: 'oc-replay-badges' })
    expect(badge.findAllByType('small').map(n => n.props.children)).not.toContain('자세 라벨')
    expect(badge.findAllByType('span')).toHaveLength(1)
    expect(ui.root.findAllByType('circle')).toHaveLength(13)
    expect(ui.root.findByProps({ className: 'oc-player-controls' }).findAllByProps({ className: 'oc-player-settings' })).toHaveLength(0)
    expect(ui.root.findByProps({ className: 'oc-player-utilities' }).findByProps({ className: 'oc-player-settings' })).toBeDefined()
    act(() => ui.root.findAllByType(SelectMenu).find(s => s.props.label === '재생 속도')!.props.onChange('2'))
    act(() => button('재생').props.onClick()); act(() => { vi.advanceTimersByTime(200) })
    expect(position().props.value).toBe(400)
    act(() => position().props.onChange({ currentTarget: { value: '500' } }))
    expect(button('재생')).toBeDefined()
    act(() => button('5초 앞으로').props.onClick()); expect(position().props.value).toBe(1000)
    act(() => button('5초 뒤로').props.onClick()); expect(position().props.value).toBe(0)
    act(() => button('재생').props.onClick()); act(() => { vi.advanceTimersByTime(1000) })
    expect(position().props.value).toBe(1000); expect(button('재생')).toBeDefined()
    expect(getRecording).toHaveBeenCalledOnce()
    act(() => button('전체 데이터 JSON').props.onClick()); expect(downloadObservationReplay).toHaveBeenCalledOnce()
  })
  it('seeks by five seconds from a nonzero start, clamps endpoints and pauses', () => {
    const next = data(); next.runId = 'synthetic-five-second-seek'
    next.frames = next.frames.map((frame, index) => ({ ...frame, elapsedMs: 2000 + index * 2000 }))
    getRecording.mockReturnValueOnce(next)
    act(() => ui.update(<ObservationReplay {...props()} count={12} />))
    expect(button('5초 뒤로').props.disabled).toBe(true)
    act(() => button('5초 앞으로').props.onClick()); expect(position().props.value).toBe(7000)
    act(() => button('재생').props.onClick())
    act(() => button('5초 앞으로').props.onClick()); expect(position().props.value).toBe(12000)
    expect(button('재생')).toBeDefined()
    act(() => button('5초 뒤로').props.onClick()); expect(position().props.value).toBe(7000)
    act(() => position().props.onChange({ currentTarget: { value: 21000 } }))
    act(() => button('5초 앞으로').props.onClick()); expect(position().props.value).toBe(22000)
    expect(button('5초 앞으로').props.disabled).toBe(true)
    expect(next.frames[0].elapsedMs).toBe(2000)
  })
  it('pauses when hidden or live measurement starts and disables competing operations', () => {
    act(() => button('재생').props.onClick())
    act(() => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')) })
    expect(button('재생')).toBeDefined()
    act(() => ui.update(<ObservationReplay {...props()} active />))
    expect(ui.root.findAllByProps({ 'aria-label': '리플레이 위치' })).toHaveLength(0)
    expect(button('파일 불러오기').props.disabled).toBe(true)
    act(() => ui.update(<ObservationReplay {...props()} visible={false} />))
    act(() => { vi.advanceTimersByTime(500) }); expect(position().props.value).toBe(0)
  })
  it('shows the actual existing normalized ML input in front and side views without changing the recording', () => {
    const view = ui.root.findAllByType(SelectMenu).find(s => s.props.label === '리플레이 좌표 보기')!
    expect(ui.root.findAllByType('circle')[0].props.cx).toBe(320)
    act(() => view.props.onChange('model-front'))
    expect(ui.root.findAllByType('circle')).toHaveLength(13)
    expect(ui.root.findAllByType('circle')[0].props.cx).toBeCloseTo(0)
    act(() => view.props.onChange('model-side'))
    expect(ui.root.findAllByType('circle')[0].props.cx).toBeCloseTo(-.2)
    expect(getRecording).toHaveBeenCalledOnce()
  })
  it('automatically connects a finished measurement cycle and replaces it after the next measurement', () => {
    expect(position().props.max).toBe(1000)
    expect(button('최근 측정 보기').props['aria-pressed']).toBe(true)
    expect(JSON.stringify(ui.toJSON())).not.toContain('이전 CSV만으로는')
    act(() => ui.update(<ObservationReplay {...props()} active />))
    expect(ui.root.findAllByProps({ 'aria-label': '리플레이 위치' })).toHaveLength(0)
    const next = data(); next.runId = 'synthetic-second-cycle'; next.frames = next.frames.slice(0,3)
    getRecording.mockReturnValueOnce(next)
    act(() => ui.update(<ObservationReplay {...props()} count={3} />))
    expect(position().props.max).toBe(200)
    expect(position().props.value).toBe(0)
    expect(button('재생')).toBeDefined()
  })
  it('keeps file import in a modal and can return from a file to the current measurement cycle', () => {
    act(() => button('파일 불러오기').props.onClick())
    expect(ui.root.findByType('dialog').props['aria-modal']).toBe('true')
    act(() => ui.root.findByType(ReplayImportDialog).props.onCancel())
    expect(position().props.max).toBe(1000)
    act(() => button('파일 불러오기').props.onClick())
    const imported = data(); imported.frames = imported.frames.slice(0,3)
    act(() => ui.root.findByType(ReplayImportDialog).props.onLoad(imported))
    expect(position().props.max).toBe(200)
    expect(button('파일 불러오기').props['aria-pressed']).toBe(true)
    act(() => ui.update(<ObservationReplay {...props()} visible={false} />))
    act(() => ui.update(<ObservationReplay {...props()} />))
    expect(position().props.max).toBe(200)
    act(() => button('최근 측정 보기').props.onClick())
    expect(position().props.max).toBe(1000)
    expect(button('최근 측정 보기').props['aria-pressed']).toBe(true)
  })
  it('keeps all six information cards in an empty player without inventing values or a label', () => {
    act(() => ui.unmount())
    act(() => { ui = create(<ObservationReplay visible active={false} count={0} dropped={0} getRecording={() => null} />) })
    const metrics = ui.root.findByType(ObservationMetrics)
    expect(metrics.props.values).toBeNull()
    expect(metrics.props.samples).toEqual([])
    expect(ui.root.findAllByType('article')).toHaveLength(6)
    expect(ui.root.findByProps({ 'aria-label': '현재 자세 라벨' }).findByType('strong').props.children).toBe('등록된 자세 없음')
    expect(ui.root.findAllByProps({ 'aria-label': '리플레이 위치' })).toHaveLength(0)
    const settings = ui.root.findByProps({ className: 'oc-player-settings' })
    expect(settings.findByProps({ 'aria-label': '리플레이 설정' })).toBeDefined()
    expect(settings.findAllByType('button').some(node => node.props.children === '파일 불러오기')).toBe(true)
    expect(ui.root.findAllByProps({ className: 'oc-player-controls' })).toHaveLength(0)
    expect(button('파일 불러오기').props.disabled).toBe(false)
  })
  it('uses the recorded task at the playback position as the posture label', () => {
    const next = data(); next.runId = 'synthetic-changing-label'; next.frames[5] = { ...next.frames[5], task: 'stretch', phase: 'return' }
    getRecording.mockReturnValueOnce(next)
    act(() => ui.update(<ObservationReplay {...props()} count={12} />))
    const label = () => ui.root.findByProps({ 'aria-label': '현재 자세 라벨' }).findByType('strong').props.children
    expect(label()).toBe('이탈 자세')
    act(() => position().props.onChange({ currentTarget: { value: '500' } }))
    expect(label()).toBe('앉은 채 스트레칭')
    act(() => position().props.onChange({ currentTarget: { value: '0' } }))
    expect(label()).toBe('이탈 자세')
    expect(ui.root.findByType(ObservationMetrics).props.values).toBeNull()
  })

})
