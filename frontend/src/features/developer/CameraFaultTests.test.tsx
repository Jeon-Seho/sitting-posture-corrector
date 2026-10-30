import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraFaultTests } from './CameraFaultTests'
describe('isolated camera fault controls', () => {
  let renderer: ReactTestRenderer
  afterEach(() => { act(() => renderer?.unmount()); vi.useRealTimers(); vi.restoreAllMocks() })
  it.each([
    ['GPU 실패 → CPU 성공', 'CPU 성공', '자원 해제 1'],
    ['GPU·CPU 모두 실패', '실패 확인', '자원 해제 0'],
    ['준비 시간 초과', '시간 초과 확인', '자원 해제 1'],
    ['전환 중 취소', '취소 완료', '자원 해제 1'],
  ])('runs %s through shared fallback and reports cleanup', async (label, result, cleanup) => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => { renderer = create(<CameraFaultTests />) })
    act(() => renderer.root.findAllByType('button').find(button => button.children.join('') === label)!.props.onClick())
    expect(renderer.root.findAllByType('button').every(button => button.props.disabled)).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain(result)
    expect(text).toContain(cleanup)
    expect(log).toHaveBeenCalled()
    expect(renderer.root.findAllByType('button').every(button => !button.props.disabled)).toBe(true)
  })
})
