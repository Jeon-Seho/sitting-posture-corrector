import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { CameraPerformanceDialog } from './CameraPerformanceDialog'
import { dismissPerformanceNotice, reportPerformance } from './acceleration'

describe('web camera performance notice', () => {
  let renderer: ReactTestRenderer
  afterEach(() => { act(() => { renderer?.unmount(); dismissPerformanceNotice() }) })

  it('explains CPU performance, settings and detection limits, then dismisses', () => {
    act(() => { renderer = create(<CameraPerformanceDialog />); reportPerformance('cpu', true) })
    const dialog = renderer.root.findByType('dialog')
    expect(dialog.props.role).toBe('alertdialog')
    expect(dialog.props['aria-modal']).toBe('true')
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('CPU 처리로 전환')
    expect(text).toContain('끊길 수 있어요')
    expect(text).toContain('브라우저를 다시 시작')
    expect(text).toContain('직접 읽거나 변경할 수 없어요')
    act(() => renderer.root.findByType('button').props.onClick())
    expect(renderer.toJSON()).toBeNull()
  })
  it('allows Escape to dismiss without interrupting camera actions', () => {
    act(() => { renderer = create(<CameraPerformanceDialog />); reportPerformance('limited', true) })
    let prevented = false
    act(() => renderer.root.findByType('dialog').props.onCancel({ preventDefault: () => { prevented = true } }))
    expect(prevented).toBe(true)
    expect(renderer.toJSON()).toBeNull()
  })
})
