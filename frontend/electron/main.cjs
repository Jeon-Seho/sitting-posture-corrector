// Main process: PC 창의 생성, 시작 프로그램 등록, 앱 종료를 담당한다.
const { app, BrowserWindow, dialog, ipcMain, net, protocol, screen } = require('electron')
const { pathToFileURL } = require('node:url')
const fs = require('node:fs')
const path = require('node:path')

// 일체형 제목 표시줄: OS 기본 틀 대신 앱 화면을 창 끝까지 그리고, 창 버튼만 위에 겹친다.
// 높이와 색은 frontend/src/styles/base.css의 --titlebar-h, --bg와 맞춘다.
const TITLEBAR_HEIGHT = 40
const MIN_WIDTH = 1180
const MIN_HEIGHT = 760
const isMac = process.platform === 'darwin'

// 설치용(패키징) 앱은 빌드된 dist를 app://posegood 으로 제공한다. 절대 경로(/mediapipe/...)가 그대로 동작한다.
const APP_URL = 'app://posegood/index.html'
const DIST = path.join(__dirname, '..', 'dist')
if (app.isPackaged) {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ])
}
const DEV_URL = process.env.POSEGOOD_DEV_URL || 'http://127.0.0.1:5173/'
// 개발 실행은 로컬 개발 서버만 연다. 외부 웹 주소는 받지 않는다.
const address = new URL(app.isPackaged ? APP_URL : DEV_URL)
if (!app.isPackaged && (address.protocol !== 'http:' || address.hostname !== '127.0.0.1'))
  throw new Error('Local development URL required')

// 개발 실행에서만: POSEGOOD_DEBUG_PORT를 주면 로컬 CDP 포트를 열어 앱 화면을 자동 점검할 수 있다.
if (!app.isPackaged && /^\d{4,5}$/.test(process.env.POSEGOOD_DEBUG_PORT ?? '')) {
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
  app.commandLine.appendSwitch('remote-debugging-port', process.env.POSEGOOD_DEBUG_PORT)
}

// 시작 프로그램으로 실행될 때 붙는 인자. 페이지는 이 값으로 자동 카메라 연결 여부를 정한다.
const LOGIN_ARG = '--launched-at-login'
// Portable 실행 파일은 임시 폴더에 풀리므로 원래 EXE를 시작 프로그램 대상으로 사용한다.
const loginExecutable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
const loginOptions = { path: loginExecutable, args: [LOGIN_ARG] }
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
    // 자세 알림 팝업은 기본으로 켠다. 설정 화면에서 끌 수 있다.
    return { autoCamera: value.autoCamera === true, alertPopup: value.alertPopup !== false }
  } catch {
    return { autoCamera: false, alertPopup: true }
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
    launchAtLogin: loginItemSupported ? app.getLoginItemSettings(loginOptions).openAtLogin : false,
    ...readSettings(),
  }
}

// IPC 요청은 이 앱 창(로컬 개발 주소)에서 온 것만 받는다.
function trusted(event) {
  try {
    return sameAddress(new URL(event.senderFrame.url))
  } catch {
    return false
  }
}

function sameAddress(url) {
  return url.protocol === address.protocol && url.host === address.host
}

ipcMain.handle('desktop:launch-info', (event) => (trusted(event) ? launchInfo() : null))
ipcMain.handle('desktop:set-launch-at-login', (event, enabled) => {
  if (!trusted(event)) return null
  if (loginItemSupported) app.setLoginItemSettings({ ...loginOptions, openAtLogin: enabled === true })
  return launchInfo()
})
ipcMain.handle('desktop:set-auto-camera', (event, enabled) => {
  if (!trusted(event)) return null
  writeSettings({ ...readSettings(), autoCamera: enabled === true })
  return launchInfo()
})
ipcMain.handle('desktop:set-alert-popup', (event, enabled) => {
  if (!trusted(event)) return null
  writeSettings({ ...readSettings(), alertPopup: enabled === true })
  if (enabled !== true) hidePopup()
  return launchInfo()
})

// 자세 알림 팝업: 앱 창이 가려졌거나 최소화됐을 때만 화면 오른쪽 아래에 띄운다.
// 포커스를 가져가지 않고(showInactive) 일정 시간 뒤 스스로 숨는다. 앱을 보고 있으면 앱 안 토스트만 쓴다.
const POPUP_WIDTH = 380
const POPUP_HEIGHT = 150
const POPUP_MS = 8000
let mainWindow = null
let popupWindow = null
let popupTimer = null
const popupURL = app.isPackaged ? 'app://posegood/alert-popup.html' : new URL('alert-popup.html', DEV_URL).toString()

function popupText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

async function ensurePopup() {
  if (popupWindow && !popupWindow.isDestroyed()) return popupWindow
  popupWindow = new BrowserWindow({
    width: POPUP_WIDTH, height: POPUP_HEIGHT, show: false, frame: false, transparent: true,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000',
    title: 'PoseGood 자세 알림',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      preload: path.join(__dirname, 'popup-preload.cjs'),
    },
  })
  popupWindow.setAlwaysOnTop(true, 'screen-saver')
  popupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  popupWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  popupWindow.on('closed', () => {
    popupWindow = null
  })
  await popupWindow.loadURL(popupURL)
  return popupWindow
}

function hidePopup() {
  if (popupTimer) clearTimeout(popupTimer)
  popupTimer = null
  if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) popupWindow.hide()
}

function appInView() {
  return !!mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()
}

ipcMain.handle('desktop:alert', async (event, alert) => {
  if (!trusted(event) || !mainWindow || event.sender !== mainWindow.webContents) return null
  if (!readSettings().alertPopup) return 'off'
  if (appInView()) return 'in-app'
  const title = popupText(alert?.title, 60), body = popupText(alert?.body, 140)
  if (!title) return null
  const popup = await ensurePopup()
  const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea
  popup.setBounds({
    x: Math.round(area.x + area.width - POPUP_WIDTH - 12),
    y: Math.round(area.y + area.height - POPUP_HEIGHT - 12),
    width: POPUP_WIDTH, height: POPUP_HEIGHT,
  })
  popup.webContents.send('popup:show', { title, body, durationMs: POPUP_MS })
  popup.showInactive()
  if (popupTimer) clearTimeout(popupTimer)
  popupTimer = setTimeout(hidePopup, POPUP_MS)
  return 'popup'
})
ipcMain.on('popup:close', (event) => {
  if (popupWindow && event.sender === popupWindow.webContents) hidePopup()
})
ipcMain.on('popup:open-app', (event) => {
  if (!popupWindow || event.sender !== popupWindow.webContents) return
  hidePopup()
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

async function createWindow() {
  const window = new BrowserWindow({
    // 자동 점검은 화면을 띄우지 않는다. 일반 실행은 기존처럼 창을 표시한다.
    show: !process.argv.includes('--posegood-smoke-hidden'),
    // 최소 크기 아래로는 카메라·오른쪽 패널·머리 영역이 함께 들어가지 않는다(docs/design/desktop-app.md).
    width: 1360, height: 860, minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT,
    title: 'PoseGood',
    icon: path.join(__dirname, '..', app.isPackaged ? 'dist' : 'public', 'branding',
      process.platform === 'win32' ? 'posegood-icon.ico' : 'posegood-icon.png'),
    backgroundColor: '#fbf5ee',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? {} : { titleBarOverlay: { color: '#fbf5ee', symbolColor: '#5e4f46', height: TITLEBAR_HEIGHT } }),
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  mainWindow = window
  // 앱을 다시 보면 팝업은 필요 없다. 앱을 닫으면 숨은 팝업 창도 함께 정리해 앱이 종료되게 한다.
  window.on('focus', hidePopup)
  window.on('closed', () => {
    mainWindow = null
    if (popupWindow && !popupWindow.isDestroyed()) popupWindow.destroy()
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
    if (!sameAddress(new URL(url))) event.preventDefault()
  })
  try {
    // 개발 서버 또는 패키징된 React 화면을 PC 창에서 연다.
    await window.loadURL(app.isPackaged ? APP_URL : DEV_URL)
  } catch {
    dialog.showErrorBox('화면을 열 수 없습니다', app.isPackaged
      ? '앱 파일을 다시 빌드하거나 복사한 뒤 실행해 주세요.'
      : '개발 서버를 켜거나 바탕화면 바로가기로 다시 실행해 주세요.')
    app.quit()
  }
}

// 시작 프로그램과 사용자가 동시에 실행해도 창은 하나만 둔다.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = mainWindow
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.whenReady().then(() => {
    if (app.isPackaged) {
      // dist 밖의 파일은 제공하지 않는다.
      protocol.handle('app', (request) => {
        try {
          const url = new URL(request.url)
          if (!sameAddress(url)) return new Response('Not found', { status: 404 })
          const file = path.resolve(DIST, '.' + decodeURIComponent(url.pathname))
          const relative = path.relative(DIST, file)
          if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Not found', { status: 404 })
          return net.fetch(pathToFileURL(file).toString())
        } catch {
          return new Response('Bad request', { status: 400 })
        }
      })
    }
    createWindow()
    app.on('activate', () => {
      if (!mainWindow) createWindow()
    })
  })
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
