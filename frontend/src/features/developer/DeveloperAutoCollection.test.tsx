import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import DeveloperAutoCollection from './DeveloperAutoCollection'
import { AutoNormalCapture } from './autoNormalCollection'
import type { AutoNormalCollectionController } from './useAutoNormalCollection'
const mock = (): AutoNormalCollectionController => ({ snapshot: new AutoNormalCapture('synthetic_ui', 'synthetic_id', '2026-10-14').snapshot(),
  error: '', observe: vi.fn(), markGap: vi.fn(), endRun: vi.fn(), setEnabled: vi.fn(), setMaximumDeviation: vi.fn(), setParticipantCode: vi.fn(), discard: vi.fn(), downloadDataset: vi.fn() })
const button = (r: ReactTestRenderer, text: string) => r.root.findAllByType('button').find(b => b.children.some(c => typeof c === 'string' && c.includes(text)))!
describe('automatic normal collection interface', () => {
  it('explains the tighter score and duration gate and keeps old rows visibly pending review', () => {
    const c = mock(); c.snapshot.total = 613; c.snapshot.requiresReviewRows = 613
    let r!: ReactTestRenderer; act(() => { r = create(<DeveloperAutoCollection collection={c} compact />) })
    const text = JSON.stringify(r.toJSON())
    expect(text).toContain('0.5')
    expect(text).toContain('1초 이어진 뒤')
    expect(text).toContain('613')
    expect(text).toContain('재검토 필요')
    expect(text).toContain('학습 사용을 차단')
    expect(button(r, 'JSON 다운로드').props.disabled).toBe(false)
    act(() => r.unmount())
  })
  it('explains temporary label and raw export, exposes the enabled toggle and disables empty exports', () => {
    const c = mock(); let r!: ReactTestRenderer; act(() => { r = create(<DeveloperAutoCollection collection={c} />) })
    expect(JSON.stringify(r.toJSON())).toContain('평가 정답 아님'); expect(JSON.stringify(r.toJSON())).toContain('원본 좌표')
    expect(button(r, 'JSON 다운로드').props.disabled).toBe(true)
    act(() => r.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: false } }))
    expect(c.setEnabled).toHaveBeenCalledWith(false)
    act(() => r.unmount())
  })
  it('shows recent rows in compact mode and keeps clearing unavailable while collecting', () => {
    const c = mock(); c.snapshot = { ...c.snapshot, total: 1, recentRows: [{ row: 1, observationTimeMs: 1500, deviation: .005, maximumDeviation: .06, displayLabel: '정상자세(자동)', segment: 0, runId: 'synthetic_run' }] }
    let r!: ReactTestRenderer; act(() => { r = create(<DeveloperAutoCollection collection={c} compact />) })
    expect(r.root.findAllByType('table')).toHaveLength(1)
    expect(button(r, '비우기').props.disabled).toBe(true)
    expect(JSON.stringify(r.toJSON())).toContain('0.500')
    act(() => button(r, '수집 행 보기').props.onClick())
    expect(r.root.findAllByType('table')).toHaveLength(1)
    act(() => button(r, 'JSON 다운로드').props.onClick()); expect(c.downloadDataset).toHaveBeenCalledOnce()
    act(() => r.unmount())
  })
  it('offers three thresholds while collecting and explains candidate windows and exclusion counts', () => {
    const c = mock(); c.snapshot.diagnostics.excluded.outside = 15; c.snapshot.diagnostics.candidateWindows = 8; c.snapshot.diagnostics.longestSegmentMs = 3900
    let r!: ReactTestRenderer; act(() => { r = create(<DeveloperAutoCollection collection={c} compact />) })
    const select = r.root.findByType('select')
    expect(select.props.value).toBe(.06)
    expect(r.root.findAllByType('option').map(option => option.props.value)).toEqual([.005, .03, .06])
    act(() => select.props.onChange({ target: { value: '0.03' } }))
    expect(c.setMaximumDeviation).toHaveBeenCalledWith(.03)
    expect(JSON.stringify(r.toJSON())).toContain('연속 학습 후보')
    expect(JSON.stringify(r.toJSON())).toContain('학습·정확도 검증 완료 수가 아니며')
    expect(r.root.findAllByType('details')).toHaveLength(1)
    act(() => r.unmount())
  })
})
