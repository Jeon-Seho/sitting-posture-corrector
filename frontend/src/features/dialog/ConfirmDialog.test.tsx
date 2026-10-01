import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

// Real focus and native modality are tested in Chrome; these tests cover action semantics only.
describe('confirmation action lifetime', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => act(() => renderer?.unmount()))

  function mount(
    options: {
      disabled?: boolean
      onConfirm?: () => void | Promise<void>
      onCancel?: () => void
    } = {},
  ) {
    const onCancel = options.onCancel ?? vi.fn()
    const onConfirm = options.onConfirm ?? vi.fn()
    act(() => {
      renderer = create(
        <ConfirmDialog
          title="합성 확인 작업"
          confirmLabel="실행"
          {...options}
          onCancel={onCancel}
          onConfirm={onConfirm}
        >
          <p>이 내용은 합성 테스트입니다.</p>
        </ConfirmDialog>,
      )
    })
    return { onCancel, onConfirm }
  }
  const dialog = () => renderer!.root.findByType('dialog')
  const button = (label: string) =>
    renderer!.root.findAllByType('button').find((node) => node.children.join('') === label)!

  it('labels the native dialog with a unique title and description and puts cancellation first', () => {
    mount()
    expect(dialog().props['aria-modal']).toBe('true')
    expect(dialog().props['aria-labelledby']).toBe(renderer!.root.findByType('h2').props.id)
    expect(
      renderer!.root.findByProps({ id: dialog().props['aria-describedby'] }).children,
    ).toHaveLength(1)
    expect(renderer!.root.findAllByType('button').map((node) => node.children.join(''))).toEqual([
      '취소',
      '실행',
    ])
  })

  it('keeps a disabled confirmation inactive while cancellation remains available', async () => {
    const { onCancel, onConfirm } = mount({ disabled: true })
    expect(button('실행').props.disabled).toBe(true)
    expect(button('취소').props.disabled).toBe(false)
    await act(async () => {
      await button('실행').props.onClick()
    })
    act(() => button('취소').props.onClick())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('blocks duplicate confirmation and cancellation until a pending action settles', async () => {
    let finish!: () => void
    const action = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { onConfirm, onCancel } = mount({ onConfirm: vi.fn(() => action) })
    const confirm = button('실행').props.onClick
    let pending: Promise<void>
    act(() => {
      pending = confirm()
      void confirm()
    })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(button('실행').props.disabled).toBe(true)
    expect(button('취소').props.disabled).toBe(true)
    const preventDefault = vi.fn()
    act(() => dialog().props.onCancel({ preventDefault }))
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
    expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toContain('처리 중')
    await act(async () => {
      finish()
      await pending!
    })
    expect(button('실행').props.disabled).toBe(false)
    act(() => button('취소').props.onClick())
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('handles native Escape through cancellation without confirming', () => {
    const { onConfirm, onCancel } = mount()
    const preventDefault = vi.fn()
    act(() => dialog().props.onCancel({ preventDefault }))
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('cancels a backdrop click but keeps a click in the panel inert', () => {
    const { onCancel } = mount()
    const target = {
      getBoundingClientRect: () => ({ left: 100, right: 500, top: 100, bottom: 400 }),
    }
    act(() => dialog().props.onClick({ target, currentTarget: target, clientX: 110, clientY: 120 }))
    expect(onCancel).not.toHaveBeenCalled()
    act(() => dialog().props.onClick({ target, currentTarget: target, clientX: 0, clientY: 0 }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('preserves the dialog and permits retry when an asynchronous action rejects', async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('Synthetic failure'))
      .mockResolvedValueOnce(undefined)
    mount({ onConfirm })
    await act(async () => {
      await button('실행').props.onClick()
    })
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain(
      '처리하지 못했습니다',
    )
    expect(button('실행').props.disabled).toBe(false)
    await act(async () => {
      await button('실행').props.onClick()
    })
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })

  it('does not write component state after the confirmed action unmounts the dialog', async () => {
    let finish!: () => void
    const action = new Promise<void>((resolve) => {
      finish = resolve
    })
    mount({ onConfirm: () => action })
    let pending!: Promise<void>
    act(() => {
      pending = button('실행').props.onClick()
    })
    act(() => renderer!.unmount())
    renderer = undefined
    await act(async () => {
      finish()
      await pending
    })
  })
})
