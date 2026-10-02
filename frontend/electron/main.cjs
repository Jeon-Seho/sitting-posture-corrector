// Main process: PC 창의 생성, 시작 프로그램 등록, 앱 종료를 담당한다.
const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

// 일체형 제목 표시줄: OS 기본 틀 대신 앱 화면을 창 끝까지 그리고, 창 버튼만 위에 겹친다.
// 높이와 색은 frontend/src/styles/base.css의 --titlebar-h, --bg와 맞춘다.
const TITLEBAR_HEIGHT = 40
const MIN_WIDTH = 1180
const MIN_HEIGHT = 760
const isMac = process.platform === 'darwin'

const DEV_URL = process.env.POSEGOOD_DEV_URL || 'http://127.0.0.1:5173/'
// 바로가기 실행기는 빈 로컬 포트를 사용한다. 외부 웹 주소는 받지 않는다.
const address = new URL(DEV_URL)
if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1') throw new Error('Local development URL required')

// 개발 실행에서만: POSEGOOD_DEBUG_PORT를 주면 로컬 CDP 포트를 열어 앱 화면을 자동 점검할 수 있다.
if (!app.isPackaged && /^\d{4,5}$/.test(process.env.POSEGOOD_DEBUG_PORT ?? '')) {
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
  app.commandLine.appendSwitch('remote-debugging-port', process.env.POSEGOOD_DEBUG_PORT)
}

// 시작 프로그램으로 실행될 때 붙는 인자. 페이지는 이 값으로 자동 카메라 연결 여부를 정한다.
const LOGIN_ARG = '--launched-at-login'
const launchedAtLogin =
  process.argv.includes(LOGIN_ARG) ||
  (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin === true)

// 개발 실행(electron main.cjs)은 개발 서버가 있어야 하므로 시작 프로그램 등록을 막는다.
// 패키징된 앱에서만 OS 시작 프로그램에 등록한다. 패키징은 docs/design/desktop-app.md 참고.
const loginItemSupported = app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin')

const settingsFile = () => path.join(app.getPath('userData'), 'desktop-settings.json')
function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
    return { autoCamera: value.autoCamera === true }
  } catch {
    return { autoCamera: false }
  }
}
function writeSettings(next) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2))
}

function launchInfo() {
  return {
    platform: process.platform,
    packaged: app.isPackaged,
    launchedAtLogin,
    launchAtLoginSupported: loginItemSupported,
    launchAtLogin: loginItemSupported ? app.getLoginItemSettings({ args: [LOGIN_ARG] }).openAtLogin : false,
    ...readSettings(),
  }
}

// IPC 요청은 이 앱 창(로컬 개발 주소)에서 온 것만 받는다.
function trusted(event) {
  try {
    return new URL(event.senderFrame.url).origin === address.origin
  } catch {
    return false
  }
}

ipcMain.handle('desktop:launch-info', (event) => (trusted(event) ? launchInfo() : null))
ipcMain.handle('desktop:set-launch-at-login', (event, enabled) => {
  if (!trusted(event)) return null
  if (loginItemSupported) app.setLoginItemSettings({ openAtLogin: enabled === true, args: [LOGIN_ARG] })
  return launchInfo()
})
ipcMain.handle('desktop:set-auto-camera', (event, enabled) => {
  if (!trusted(event)) return null
  writeSettings({ ...readSettings(), autoCamera: enabled === true })
  return launchInfo()
})

async function createWindow() {
  const window = new BrowserWindow({
    // 최소 크기 아래로는 카메라·오른쪽 패널·머리 영역이 함께 들어가지 않는다(docs/design/desktop-app.md).
    width: 1360, height: 860, minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT,
    title: 'PoseGood',
    backgroundColor: '#fbf5ee',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? {} : { titleBarOverlay: { color: '#fbf5ee', symbolColor: '#5e4f46', height: TITLEBAR_HEIGHT } }),
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  // Alt를 눌러도 File/Edit 메뉴 바가 나타나지 않게 메뉴 자체를 없앤다(macOS는 시스템 메뉴 유지).
  if (!isMac) window.removeMenu()
  if (!app.isPackaged) {
    // 메뉴가 없어도 개발 중에는 새로고침·개발자 도구 단축키를 쓸 수 있게 둔다.
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const key = input.key.toLowerCase()
      if (input.key === 'F12' || ((input.control || input.meta) && input.shift && key === 'i')) {
        window.webContents.toggleDevTools()
        event.preventDefault()
      } else if ((input.control || input.meta) && key === 'r') {
        window.webContents.reload()
        event.preventDefault()
      }
    })
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== address.origin) event.preventDefault()
  })
  try {
    // React 개발 화면을 PC 창에서 연다.
    await window.loadURL(DEV_URL)
  } catch {
    dialog.showErrorBox('화면을 열 수 없습니다', '개발 서버를 켜거나 바탕화면 바로가기로 다시 실행해 주세요.')
    app.quit()
  }
}

// 시작 프로그램과 사용자가 동시에 실행해도 창은 하나만 둔다.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.whenReady().then(() => {
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
