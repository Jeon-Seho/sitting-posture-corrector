// Independent experiment: distinct userData, no account or service data access.
const { app, BrowserWindow, protocol, net } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const version = require('../package.json').version
app.setName('PoseGood Face Lab')
const smokeProfile = process.argv.find(v => v.startsWith('--lab-profile='))?.slice('--lab-profile='.length)
const smokeHidden = process.argv.includes('--lab-smoke-hidden')
app.setPath('userData', smokeHidden && smokeProfile ? path.resolve(smokeProfile) : path.join(app.getPath('appData'), 'PoseGood-Face-Lab'))
protocol.registerSchemesAsPrivileged([{ scheme: 'lab', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '..', 'dist-face')
  protocol.handle('lab', request => {
    const url = new URL(request.url)
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname))
    if (url.hostname !== 'posegood' || !file.startsWith(root + path.sep)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).href)
  })
  const title = `PoseGood · 얼굴 동작 실험 ${version}`
  const window = new BrowserWindow({ show: !smokeHidden, width: 1280, height: 900, minWidth: 900, minHeight: 700, title, backgroundColor: '#fbf5ee', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
  window.on('page-title-updated', event => { event.preventDefault(); window.setTitle(title) })
  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('lab://posegood/') && !url.startsWith('http://127.0.0.1:5186/')) event.preventDefault() })
  await window.loadURL(app.isPackaged ? 'lab://posegood/index.html' : 'http://127.0.0.1:5186/')
})
app.on('window-all-closed', () => app.quit())
