import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../dialog/ConfirmDialog'
import { ObservationGuide } from './ObservationGuide'
import { ObservationProtocol } from './observationProtocol'

const controls = { onStart: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() }
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('')
describe('guided camera workspace with explicit synthetic clock', () => {
  it('offers an enabled camera button when off, without the timer card or inline mode picker', () => {
    const protocol = new ObservationProtocol(), onStart = vi.fn()
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(0)} active={false} ready={false} {...controls} onStart={onStart} />) })
    expect(ui.root.findAllByProps({ role: 'timer' })).toHaveLength(0)
    expect(ui.root.findAllByProps({ 'aria-label': '진행 모드' })).toHaveLength(0)
    const start = ui.root.findByType('button')
    expect(text(start)).toBe('카메라 켜기'); expect(start.props.disabled).not.toBe(true)
    act(() => start.props.onClick()); expect(onStart).toHaveBeenCalledOnce()
    act(() => ui.unmount())
  })
  it('shows the reference countdown and puts phase and position in the same metadata row', () => {
    const protocol = new ObservationProtocol()
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(0)} ready={false} setup={{ status: 'preparing', remainingMs: 2000 }} {...controls} />) })
    const timer = () => ui.root.findByProps({ role: 'timer' })
    expect(text(timer())).toContain('기준 자세를 등록합니다')
    expect(text(timer())).toContain('02초')
    const meta = ui.root.findByProps({ className: 'oc-clock-meta' })
    expect(meta.findAllByType('span').map(text)).toEqual(['2초 뒤 기준 등록', '4동작 · 3바퀴'])
    expect(timer().props['aria-live']).toBe('off')
    const stop = ui.root.findByProps({ className: 'oc-guide-controls' }).findAllByType('button').find(button => text(button) === '측정 종료')!
    expect(stop.props.disabled).not.toBe(true)
    act(() => stop.props.onClick()); expect(controls.onStop).not.toHaveBeenCalled()
    act(() => ui.root.findByType(ConfirmDialog).props.onConfirm()); expect(controls.onStop).toHaveBeenCalledOnce()
    act(() => ui.update(<ObservationGuide guide={protocol.snapshot(0)} ready={false} setup={{ status: 'registering', remainingMs: 8000 }} {...controls} />))
    expect(text(timer())).toContain('08초')
    expect(text(ui.root.findByProps({ role: 'status' }))).toContain('8초 유지')
    act(() => ui.unmount())
  })
  it('enables manual next only after the phase has finished and tracking is ready', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-manual-ui', 'manual')
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(0)} ready {...controls} />) })
    const next = (label: string) => ui.root.findAllByType('button').find(b => text(b) === label)!
    expect(next('다음').props.disabled).toBe(true)
    expect(next('다음').props.className).toContain('oc-next-guide')
    for (let now = 100; now <= 2000; now += 100) protocol.advance(now)
    act(() => ui.update(<ObservationGuide guide={protocol.snapshot(2000)} ready {...controls} />))
    expect(next('다음').props.disabled).toBe(false)
    expect(ui.root.findByProps({ role: 'status' }).props.className).toBe('oc-sr-only')
    expect(ui.root.findAllByProps({ className: 'oc-recording-state' })).toHaveLength(0)
    act(() => ui.update(<ObservationGuide guide={protocol.snapshot(2000)} ready={false} {...controls} />))
    expect(next('다음').props.disabled).toBe(true)
    act(() => ui.unmount())
  })
  it('keeps the manual next button visible and disabled throughout reference setup and pause', () => {
    const protocol = new ObservationProtocol()
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(0)} active mode="manual" ready={false} setup={{ status: 'registering', remainingMs: 8000 }} {...controls} />) })
    const next = () => ui.root.findByProps({ className: 'oc-primary oc-next-guide' })
    expect(text(next())).toBe('다음'); expect(next().props.disabled).toBe(true)
    protocol.start(0, 'synthetic-manual-pause', 'manual'); protocol.pause('user')
    act(() => ui.update(<ObservationGuide guide={protocol.snapshot(500)} active ready {...controls} />))
    expect(text(next())).toBe('다음'); expect(next().props.disabled).toBe(true)
    act(() => ui.unmount())
  })
  it('names an interrupted hold and asks the user to regain that task before restarting', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-copy')
    for (let now = 100; now <= 2000; now += 100) protocol.advance(now)
    protocol.pause('tracking_lost')
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(3000)} ready {...controls} />) })
    expect(text(ui.root)).toContain('머리 앞으로 내밀기 · 일시 정지')
    expect(text(ui.root)).toContain('자세를 다시 잡고 추적을 확인한 뒤 재개')
    expect(text(ui.root)).toContain('측정 5초를 다시 셉니다')
    act(() => ui.unmount())
  })
  it('keeps the same pause slot during setup, running, manual waiting and pause', () => {
    const protocol = new ObservationProtocol()
    let ui!: ReturnType<typeof create>
    const props = { ...controls, active: true, ready: true, mode: 'manual' as const }
    act(() => { ui = create(<ObservationGuide {...props} guide={protocol.snapshot(0)} setup={{ status: 'registering', remainingMs: 8000 }} />) })
    const pause = () => ui.root.findAllByType('button').find(b => b.props.className?.includes('oc-pause-guide'))!
    const original = pause(); expect(pause().props.disabled).toBe(true)
    protocol.start(0, 'synthetic-stable-actions', 'manual')
    act(() => ui.update(<ObservationGuide {...props} guide={protocol.snapshot(0)} />))
    expect(pause()).toBe(original); expect(pause().props.disabled).toBe(false)
    for (let t = 100; t <= 2000; t += 100) protocol.advance(t)
    act(() => ui.update(<ObservationGuide {...props} guide={protocol.snapshot(2000)} />))
    expect(pause()).toBe(original); expect(pause().props.disabled).toBe(true)
    protocol.next(2000); protocol.pause('user')
    act(() => ui.update(<ObservationGuide {...props} guide={protocol.snapshot(2100)} />))
    expect(pause()).toBe(original); expect(pause().props['aria-label']).toBe('현재 단계 처음부터 재개')
    expect(pause().props.disabled).toBe(false)
    act(() => ui.unmount())
  })
  it('keeps the bilateral task and next instruction visible during measurement', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-bilateral-copy')
    for (let now = 100; now <= 38000; now += 100) protocol.advance(now)
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(38000)} ready {...controls} />) })
    expect(text(ui.root.findByProps({ role: 'status' }))).toContain('양쪽 어깨를 함께 올린 채 유지')
    expect(text(ui.root.findByProps({ role: 'timer' }))).toContain('05초')
    expect(text(ui.root.findByProps({ 'aria-label': '다음 안내' }))).toContain('편안한 기준 자세· 복귀 준비 5초')
    act(() => ui.unmount())
  })
  it('freezes a paused timer, restarts it in full and then displays the neutral return phase', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-phase-gauge')
    for (let now = 100; now <= 3100; now += 100) protocol.advance(now)
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(3100)} ready {...controls} />) })
    expect(text(ui.root.findByProps({ role: 'timer' }))).toContain('04초')
    protocol.pause('user')
    act(() => ui.update(<ObservationGuide guide={protocol.snapshot(9000)} ready {...controls} />))
    expect(text(ui.root.findByProps({ role: 'timer' }))).toContain('04초')
    protocol.resume(10000)
    act(() => ui.update(<ObservationGuide guide={protocol.snapshot(10000)} ready {...controls} />))
    expect(text(ui.root.findByProps({ role: 'timer' }))).toContain('05초')
    for (let now = 10100; now <= 15000; now += 100) protocol.advance(now)
    act(() => ui.update(<ObservationGuide guide={protocol.snapshot(15000)} ready {...controls} />))
    expect(text(ui.root.findByProps({ className: 'oc-clock-label' }))).toBe('복귀 준비')
    expect(text(ui.root.findByProps({ 'aria-label': '다음 안내' }))).toContain('고개 숙이기')
    act(() => ui.unmount())
  })
  it('offers restart and JSON download for preserved measurements after stopping', () => {
    const protocol = new ObservationProtocol(), onStart = vi.fn(), onDownload = vi.fn()
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(0)} ready={false} active={false} hasRecording onDownload={onDownload} {...controls} onStart={onStart} />) })
    const buttons = ui.root.findAllByType('button')
    expect(buttons.map(text)).toEqual(['다시 측정', 'JSON 다운로드'])
    act(() => buttons[0].props.onClick()); expect(onStart).toHaveBeenCalledOnce()
    act(() => buttons[1].props.onClick()); expect(onDownload).toHaveBeenCalledOnce()
    act(() => ui.unmount())
  })
  it('retains completed progress and offers camera restart with downloads delegated to the tools', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-completed')
    for (let now = 100; now <= 144000; now += 100) protocol.advance(now)
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(144000)} ready={false} active={false} {...controls} />) })
    expect(ui.root.findByType('progress').props).toMatchObject({ value: 36, max: 36 })
    expect(ui.root.findAllByType('button').map(text)).toEqual(['카메라 켜기'])
    expect(ui.root.findAllByProps({ role: 'status' })).toHaveLength(0)
    act(() => ui.unmount())
  })
})
