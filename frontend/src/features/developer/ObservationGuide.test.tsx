import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ObservationGuide } from './ObservationGuide'
import { ObservationProtocol } from './observationProtocol'

const controls = { onStart: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onExport: vi.fn() }
const renderedText = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(renderedText).join('')
describe('guided task instructions from an explicit synthetic protocol clock', () => {
  it('requires camera/reference readiness and keeps the ticking timer outside live announcements', () => {
    const protocol = new ObservationProtocol()
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(0)} ready={false} hasTrace={false} {...controls} />) })
    expect(ui.root.findByType('button').props.disabled).toBe(true)
    expect(ui.root.findByProps({ role: 'timer' }).props['aria-live']).toBe('off')
    act(() => ui.unmount())
  })
  it('names the interrupted hold and asks the user to regain that task before restarting its timer', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-copy')
    for (let now = 100; now <= 2000; now += 100) protocol.advance(now)
    protocol.pause('tracking_lost')
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(3000)} ready hasTrace {...controls} />) })
    const text = JSON.stringify(ui.toJSON())
    expect(text).toContain('머리 앞으로 내밀기 · 일시 정지')
    expect(text).toContain('자세를 다시 잡고 추적을 확인한 뒤 재개')
    expect(text).toContain('유지 5초를 다시 셉니다')
    act(() => ui.unmount())
  })
  it('offers the complete time-series CSV after completion and keeps the 36-phase progress', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-completed-copy')
    for (let now = 100; now <= 144000; now += 100) protocol.advance(now)
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(144000)} ready={false} hasTrace {...controls} />) })
    expect(ui.root.findByType('button').props.disabled).toBe(false)
    expect(JSON.stringify(ui.toJSON())).toContain('자동 안내 시계열 CSV')
    expect(ui.root.findByType('progress').props.value).toBe(36)
    act(() => ui.unmount())
  })
  it('keeps the bilateral shoulder task explicit during the hold and previews neutral return then the next round', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-bilateral-copy')
    for (let now = 100; now <= 38000; now += 100) protocol.advance(now)
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(38000)} ready hasTrace {...controls} />) })
    expect(ui.root.findByProps({ role: 'status' }).findByType('h3').children.join('')).toBe('양쪽 어깨 함께 올리기')
    expect(ui.root.findByProps({ role: 'status' }).findAllByType('p').at(-1)!.children.join('')).toContain('양쪽 어깨를 함께 올린 채 유지')
    expect(ui.root.findByProps({ 'aria-label': '다음 안내' }).findByType('strong').children.join('')).toBe('편안한 기준 자세')
    for (let now = 38100; now <= 43000; now += 100) protocol.advance(now)
    act(() => ui.update(<ObservationGuide guide={protocol.snapshot(43000)} ready hasTrace {...controls} />))
    expect(ui.root.findByProps({ 'aria-label': '다음 안내' }).findByType('strong').children.join('')).toBe('머리 앞으로 내밀기')
    act(() => ui.unmount())
  })
  it('puts the active phase and remaining seconds inside its gauge, freezes on pause, and restarts before neutral return', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-phase-gauge')
    for (let now = 100; now <= 2000; now += 100) protocol.advance(now)
    let ui!: ReturnType<typeof create>
    const update = (now: number) => act(() => ui.update(<ObservationGuide guide={protocol.snapshot(now)} ready hasTrace {...controls} />))
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(2000)} ready hasTrace {...controls} />) })
    const phases = () => ui.root.findByProps({ 'aria-label': '동작마다 반복하는 단계' })
    const active = () => phases().findByProps({ 'aria-current': 'step' })
    const label = () => renderedText(active().findByProps({ className: 'oc-phase-label' }))
    expect(phases().type).toBe('ol')
    expect(phases().findAllByType('li').map(phase => phase.props['data-phase'])).toEqual(['move', 'hold', 'return'])
    expect(active().props['data-phase']).toBe('hold')
    expect(label()).toMatch(/유지.*5\s*초.*남음/s)
    for (let now = 2100; now <= 3100; now += 100) protocol.advance(now)
    update(3100)
    expect(label()).toMatch(/유지.*4\s*초.*남음/s)
    protocol.pause('user')
    update(9000)
    expect(active().props['data-phase']).toBe('hold')
    expect(label()).toMatch(/유지.*4\s*초.*남음/s)
    expect(renderedText(active())).toContain('멈춤')
    expect(ui.root.findByProps({ role: 'timer' }).props['aria-live']).toBe('off')
    expect(protocol.resume(10000)).toBe(true)
    update(10000)
    expect(label()).toMatch(/유지.*5\s*초.*남음/s)
    expect(renderedText(active())).not.toContain('멈춤')
    for (let now = 10100; now <= 15000; now += 100) protocol.advance(now)
    update(15000)
    expect(active().props['data-phase']).toBe('return')
    expect(label()).toMatch(/복귀.*5\s*초.*남음/s)
    expect(ui.root.findByProps({ role: 'status' }).findByType('h3').children.join('')).toBe('편안한 기준 자세로 돌아오세요')
    expect(ui.root.findByProps({ 'aria-label': '다음 안내' }).findByType('strong').children.join('')).toBe('고개 숙이기')
    act(() => ui.unmount())
  })
  it('ends phase highlighting after completion while retaining full 36-phase progress and explicit CSV download', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-completed-phase-gauge')
    for (let now = 100; now <= 144000; now += 100) protocol.advance(now)
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationGuide guide={protocol.snapshot(144000)} ready={false} hasTrace {...controls} />) })
    const phases = ui.root.findByProps({ 'aria-label': '동작마다 반복하는 단계' })
    expect(phases.findAllByProps({ 'aria-current': 'step' })).toHaveLength(0)
    expect(ui.root.findByType('progress').props).toMatchObject({ value: 36, max: 36 })
    expect(ui.root.findAllByType('button').map(renderedText)).toEqual(['자동 안내 시계열 CSV'])
    expect(renderedText(ui.root)).not.toContain('안내·측정 종료')
    act(() => ui.unmount())
  })
})
