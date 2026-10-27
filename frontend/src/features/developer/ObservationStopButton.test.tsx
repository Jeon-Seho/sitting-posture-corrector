import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { ObservationStopButton } from './ObservationStopButton'
import { ConfirmDialog } from '../dialog/ConfirmDialog'
let ui: ReactTestRenderer
afterEach(() => act(() => ui.unmount()))
it('requires confirmation and cancellation never stops or discards the session', () => {
  const stop = vi.fn()
  act(() => { ui = create(<ObservationStopButton onStop={stop} />) })
  act(() => ui.root.findByType('button').props.onClick())
  expect(stop).not.toHaveBeenCalled()
  act(() => ui.root.findByType(ConfirmDialog).props.onCancel())
  expect(stop).not.toHaveBeenCalled(); expect(ui.root.findAllByType('dialog')).toHaveLength(0)
  act(() => ui.root.findByType('button').props.onClick())
  act(() => ui.root.findByType(ConfirmDialog).props.onConfirm())
  expect(stop).toHaveBeenCalledOnce(); expect(ui.root.findAllByType('dialog')).toHaveLength(0)
})
