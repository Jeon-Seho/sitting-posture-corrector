import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DeveloperTraining from './DeveloperTraining'

afterEach(() => vi.unstubAllGlobals())
const button = (r: ReactTestRenderer, text: string) => r.root.findAllByType('button').find(b => b.children.includes(text))!
describe('developer local training guidance', () => {
  it('links the explicit load action without claiming browser training or verified accuracy', () => {
    const open = vi.fn(); let r!: ReactTestRenderer
    act(() => { r = create(<DeveloperTraining onOpenSettings={open} />) })
    const content = JSON.stringify(r.toJSON())
    expect(content).toContain('미검토 후보')
    expect(content).toContain('자세 판정 성능은 별도 평가가 필요합니다')
    expect(content).toContain('참여자를 겹치지 않게')
    act(() => button(r, '학습 모델 불러오기').props.onClick())
    expect(open).toHaveBeenCalledOnce()
    act(() => r.unmount())
  })
  it('copies only explicit local commands, using a private new output directory', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    let r!: ReactTestRenderer; act(() => { r = create(<DeveloperTraining />) })
    await act(async () => { button(r, '명령 복사').props.onClick() })
    expect(writeText).toHaveBeenCalledOnce()
    const command = writeText.mock.calls[0][0]
    expect(command).toContain('model.analysis.mediapipe_lstm validate')
    expect(command).toContain('--mode pilot')
    expect(command).toContain('--output "$HOME/posture-private/run-01"')
    expect(r.root.findByType('textarea').props.value).toBe(command)
    expect(r.root.findByProps({ role: 'status' }).children.join('')).toContain('복사했습니다')
    expect(r.root.findAllByType('button')).toHaveLength(1)
    act(() => r.unmount())
  })
  it('keeps commands selectable if clipboard access fails', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('unavailable')) } })
    let r!: ReactTestRenderer; act(() => { r = create(<DeveloperTraining />) })
    await act(async () => { button(r, '명령 복사').props.onClick() })
    expect(r.root.findByProps({ role: 'status' }).children.join('')).toContain('직접 복사')
    expect(r.root.findByType('textarea').props.readOnly).toBe(true)
    act(() => r.unmount())
  })
})
