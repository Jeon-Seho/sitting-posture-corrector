import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const { installCameraWindow } = createRequire(import.meta.url)('../../../electron/camera-window.cjs')

type IpcHandler = (event: { sender: unknown; trusted: boolean }, ...args: unknown[]) => unknown
type OpenPolicy = { action: 'allow' | 'deny'; overrideBrowserWindowOptions?: Record<string, unknown> }

function setup() {
  const handlers = new Map<string, IpcHandler>()
  let policy!: (details: { url: string; frameName: string }) => OpenPolicy
  const contents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: vi.fn(callback => { policy = callback }), send: vi.fn(),
  })
  const main = Object.assign(new EventEmitter(), {
    webContents: contents, isDestroyed: () => false, isMinimized: () => true,
    getBounds: () => ({}), restore: vi.fn(), show: vi.fn(), focus: vi.fn(),
  })
  const ipcMain = {
    handle: (name: string, handler: IpcHandler) => handlers.set(name, handler),
    removeHandler: vi.fn((name: string) => handlers.delete(name)),
  }
  installCameraWindow({ mainWindow: main, ipcMain, trusted: (event: { trusted: boolean }) => event.trusted,
    screen: { getDisplayMatching: () => ({ workArea: { x: -800, y: 0, width: 800, height: 600 } }) },
  })
  const event = { sender: contents, trusted: true }
  const call = (name: string, ...args: unknown[]) => handlers.get(name)!(event, ...args)
  const child = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() }),
    removeMenu: vi.fn(), showInactive: vi.fn(), isDestroyed: () => false, destroy: vi.fn(),
    getBounds: () => ({ x: -380, y: 266, width: 360, height: 314 }), setSize: vi.fn(), setBounds: vi.fn(),
  })
  return { main, contents, ipcMain, handlers, event, call, child, policy: (url = 'about:blank', frameName = 'posegood-camera') => policy({ url, frameName }) }
}

describe('native camera window policy', () => {
  it('allows only the enabled camera about:blank window with a fixed native frame policy', () => {
    const s = setup()
    expect(s.policy().action).toBe('deny')
    s.call('camera:enabled', true)
    expect(s.policy('https://example.com').action).toBe('deny')
    expect(s.policy('about:blank', 'other').action).toBe('deny')
    expect(s.policy().overrideBrowserWindowOptions).toMatchObject({
      frame: false, alwaysOnTop: true, skipTaskbar: true, show: false, width: 400, height: 225, x: -420, y: 355,
    })
    s.contents.emit('did-create-window', s.child, { frameName: 'posegood-camera' })
    expect(s.policy().action).toBe('deny')
    expect(s.call('camera:show')).toBe(true)
    expect(s.child.showInactive).toHaveBeenCalledOnce()
    const event = { preventDefault: vi.fn() }
    s.child.webContents.emit('will-navigate', event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(s.child.webContents.setWindowOpenHandler.mock.calls[0][0]().action).toBe('deny')
  })
  it('rejects commands from other renderers and untrusted pages', () => {
    const s = setup()
    expect(s.handlers.get('camera:enabled')!({ sender: {}, trusted: true }, true)).toBe(false)
    expect(s.handlers.get('camera:enabled')!({ sender: s.contents, trusted: false }, true)).toBe(false)
    expect(s.policy().action).toBe('deny')
    expect(s.handlers.get('camera:return')!({ sender: {}, trusted: true })).toBe(false)
    expect(s.main.focus).not.toHaveBeenCalled()
  })
  it('requests automatic opening and cleans up on disable, reload and owner close', () => {
    const s = setup()
    s.main.emit('blur')
    expect(s.contents.send).not.toHaveBeenCalled()
    s.call('camera:enabled', true)
    s.main.emit('minimize')
    expect(s.contents.send).toHaveBeenCalledWith('camera:request')
    s.contents.emit('did-create-window', s.child, { frameName: 'posegood-camera' })
    s.call('camera:enabled', false)
    expect(s.child.destroy).toHaveBeenCalledOnce()
    s.call('camera:enabled', true)
    s.contents.emit('did-start-navigation', {}, 'http://127.0.0.1', false, true)
    expect(s.policy().action).toBe('deny')
    s.main.emit('closed')
    expect(s.ipcMain.removeHandler).toHaveBeenCalledTimes(4)
  })
  it('restores the main app explicitly without requesting a new camera', () => {
    const s = setup()
    expect(s.call('camera:return')).toBe(true)
    expect(s.main.restore).toHaveBeenCalledOnce()
    expect(s.main.focus).toHaveBeenCalledOnce()
  })
  it('collapses and restores the native bounds through main-process sizing', () => {
    const s = setup()
    s.call('camera:enabled', true)
    s.contents.emit('did-create-window', s.child, { frameName: 'posegood-camera' })
    s.call('camera:collapse', true)
    expect(s.child.setSize).toHaveBeenCalledWith(360, 48)
    s.call('camera:collapse', false)
    expect(s.child.setBounds).toHaveBeenCalledWith({ x: -380, y: 266, width: 360, height: 314 })
  })
})
