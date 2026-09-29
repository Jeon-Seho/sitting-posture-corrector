// Main process: PC 창의 생성과 앱 종료를 담당한다.
const { app, BrowserWindow, dialog } = require('electron')
const DEV_URL = process.env.POSEGOOD_DEV_URL || 'http://127.0.0.1:5173/'
// 바로가기 실행기는 빈 로컬 포트를 사용한다. 외부 웹 주소는 받지 않는다.
const address = new URL(DEV_URL)
if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1') throw new Error('Local development URL required')

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280, height: 900, minWidth: 800, minHeight: 600,
    title: 'PoseGood', autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== address.origin) event.preventDefault()
  })
  try {
    // 기존 React 개발 화면을 PC 창에서 연다.
    await window.loadURL(DEV_URL)
  } catch {
    dialog.showErrorBox('화면을 열 수 없습니다', '개발 서버를 켜거나 바탕화면 바로가기로 다시 실행해 주세요.')
    app.quit()
  }
}
app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
