import { describe, expect, it } from 'vitest'
import { act, create } from 'react-test-renderer'
import { EndingDialog } from './LiveSessionPage'

/** A stand-in for the browser's <dialog> (react-test-renderer has no DOM). */
function fakeDialog() {
  return {
    open: false,
    showModal() {
      this.open = true
    },
    close() {
      this.open = false
    },
  }
}

describe('「측정 종료」 saving dialog', () => {
  it('covers the app while ending and closes when the result is in', () => {
    const dialog = fakeDialog()
    const options = { createNodeMock: () => dialog }
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<EndingDialog open={false} />, options)
    })
    expect(dialog.open).toBe(false)
    act(() => renderer.update(<EndingDialog open />))
    expect(dialog.open).toBe(true)
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toContain('저장되면 바로 결과를')
    act(() => renderer.update(<EndingDialog open={false} />))
    expect(dialog.open).toBe(false)
  })

  it('does not close on Esc', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<EndingDialog open />, { createNodeMock: fakeDialog })
    })
    let prevented = false
    renderer.root.findByType('dialog').props.onCancel({ preventDefault: () => (prevented = true) })
    expect(prevented).toBe(true)
  })
})
