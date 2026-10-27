// Only the main renderer may create the camera preview. No URL or privileged options from it.
function installCameraWindow({ mainWindow, screen, ipcMain, trusted }) {
  let enabled = false
  let cameraWindow = null
  let expandedSize = null
  const close = () => {
    const child = cameraWindow
    cameraWindow = null
    expandedSize = null
    if (child && !child.isDestroyed()) child.destroy()
  }
  const owner = (event) => event.sender === mainWindow.webContents && trusted(event)
  ipcMain.handle('camera:enabled', (event, value) => {
    if (!owner(event)) return false
    enabled = value === true
    if (!enabled) close()
    return enabled
  })
  ipcMain.handle('camera:show', (event) => {
    if (!owner(event) || !enabled || !cameraWindow || cameraWindow.isDestroyed()) return false
    cameraWindow.showInactive()
    return true
  })
  ipcMain.handle('camera:return', (event) => {
    if (!owner(event)) return false
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return true
  })
  ipcMain.handle('camera:collapse', (event, collapsed) => {
    if (!owner(event) || !cameraWindow || cameraWindow.isDestroyed()) return false
    const bounds = cameraWindow.getBounds()
    if (collapsed === true) {
      if (!expandedSize) expandedSize = { width: bounds.width, height: bounds.height }
      cameraWindow.setSize(bounds.width, 48)
    } else if (expandedSize) {
      const area = screen.getDisplayMatching(bounds).workArea
      cameraWindow.setBounds({
        ...expandedSize,
        x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - expandedSize.width)),
        y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - expandedSize.height)),
      })
      expandedSize = null
    }
    return true
  })
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (!enabled || url !== 'about:blank' || frameName !== 'posegood-camera' || cameraWindow) return { action: 'deny' }
    const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 400, height: 225, minWidth: 280, minHeight: 48,
        x: Math.max(area.x, area.x + area.width - 420),
        y: Math.max(area.y, area.y + area.height - 245),
        frame: false, show: false, alwaysOnTop: true, skipTaskbar: true,
        minimizable: false, maximizable: false, fullscreenable: false,
        backgroundColor: '#111111', title: 'PoseGood · 카메라 작은 창',
      },
    }
  })
  mainWindow.webContents.on('did-create-window', (child, { frameName }) => {
    if (frameName !== 'posegood-camera' || !enabled) { child.destroy(); return }
    cameraWindow = child
    child.removeMenu()
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    child.webContents.on('will-navigate', (event) => event.preventDefault())
    child.on('closed', () => { if (cameraWindow === child) { cameraWindow = null; expandedSize = null } })
  })
  // showInactive keeps the user's other application focused when this is automatic.
  const request = () => {
    if (enabled && !cameraWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('camera:request')
  }
  mainWindow.on('blur', request)
  mainWindow.on('minimize', request)
  mainWindow.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) { enabled = false; close() }
  })
  mainWindow.on('closed', () => {
    enabled = false
    close()
    for (const channel of ['camera:enabled', 'camera:show', 'camera:return', 'camera:collapse']) ipcMain.removeHandler(channel)
  })
}

module.exports = { installCameraWindow }
