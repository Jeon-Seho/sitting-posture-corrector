import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReplayImportDialog } from './ReplayImportDialog'
import { ObservationReplayArchive, type ReplayContext } from './observationReplay'
import { comparisonDemo } from './comparisonDemo'
const context: ReplayContext = { phase: 'hold', task: 'head', round: 1, trial: 1, attempt: 1, segment: 1, measurement: true }
const content = () => { const a = new ObservationReplayArchive('synthetic-file-dialog','2026-10-21T00:00:00.000Z'); a.append(comparisonDemo(0,'head'),0,context); return JSON.stringify({...a.snapshot(),source:'synthetic'}) }
const file = (text = content(), patch: Partial<File> = {}) => ({ name: 'explicit-synthetic.json', size: text.length, text: async () => text, ...patch }) as File

describe('replay import modal', () => {
  let ui: ReactTestRenderer
  afterEach(() => { act(() => ui?.unmount()) })
  const mount = (onLoad = vi.fn(), onCancel = vi.fn()) => { act(() => { ui = create(<ReplayImportDialog onLoad={onLoad} onCancel={onCancel} />) }); return { onLoad, onCancel } }
  const button = (label: string) => ui.root.findAllByType('button').find(b => b.props.children === label)!
  const select = (files: File[]) => act(() => ui.root.findByProps({type:'file'}).props.onChange({ currentTarget: {files, value:'selected'} }))
  const drop = (files: File[]) => act(() => ui.root.findByProps({className:'oc-replay-dropzone'}).props.onDrop({preventDefault:vi.fn(),dataTransfer:{files}}))
  it('accepts a dropped file and imports only after explicit confirmation', async () => {
    const {onLoad} = mount()
    expect(button('불러오기').props.disabled).toBe(true)
    drop([file()]); expect(button('불러오기').props.disabled).toBe(false); expect(onLoad).not.toHaveBeenCalled()
    await act(async () => { await button('불러오기').props.onClick() })
    expect(onLoad).toHaveBeenCalledOnce()
    expect(onLoad.mock.calls[0][0].source).toBe('synthetic')
  })
  it('keeps file selection available and cancellation never imports', () => {
    const {onLoad,onCancel} = mount()
    select([file()]); act(() => button('취소').props.onClick())
    expect(onCancel).toHaveBeenCalledOnce(); expect(onLoad).not.toHaveBeenCalled()
  })
  it.each(['multiple','oversized','extension'])('rejects %s selection and disables confirmation', kind => {
    const {onLoad} = mount()
    drop(kind === 'multiple' ? [file(),file()] : [file(undefined, kind === 'oversized' ? {size:33*1024*1024} : {name:'wrong.csv'})])
    expect(ui.root.findByProps({role:'alert'})).toBeDefined()
    expect(button('불러오기').props.disabled).toBe(true); expect(onLoad).not.toHaveBeenCalled()
  })
  it('preserves the caller recording on malformed JSON and prevents late import after unmount', async () => {
    const {onLoad} = mount()
    select([file('{')]); await act(async () => { await button('불러오기').props.onClick() })
    expect(ui.root.findByProps({role:'alert'})).toBeDefined(); expect(onLoad).not.toHaveBeenCalled()
    let resolve!: (value: string) => void
    select([file(undefined,{text:() => new Promise<string>(done => { resolve = done })})])
    let confirmation!: Promise<void>
    act(() => { confirmation = button('불러오기').props.onClick() })
    act(() => ui.unmount())
    await act(async () => { resolve(content()); await confirmation })
    expect(onLoad).not.toHaveBeenCalled()
  })
})
