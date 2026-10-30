const fs = require('node:fs')
const path = require('node:path')

/** Windows ICO with a 256px PNG entry; Windows Vista and later support PNG payloads. */
function pngToIco(png) {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(22, 18)
  return Buffer.concat([header, png])
}

function installThemeIcon({ app, nativeImage, shell, mainWindow, executable, isolated }) {
  const directory = path.join(app.getPath('userData'), 'theme-icons')
  const stateFile = path.join(directory, 'current.json')
  let currentAccent = null
  const location = accent => path.join(directory, accent.slice(1) + '.ico')
  function restore() {
    try {
      const { accent } = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      if (!/^#[0-9a-f]{6}$/.test(accent)) return
      const icon = nativeImage.createFromPath(location(accent).replace(/\.ico$/, '.png'))
      if (!icon.isEmpty()) { mainWindow.setIcon(icon); currentAccent = accent }
    } catch { /* First launch or a missing cache uses the packaged charcoal icon. */ }
  }
  restore()
  return payload => {
    if (!payload || typeof payload.accent !== 'string' || !/^#[0-9a-f]{6}$/.test(payload.accent) ||
      typeof payload.png !== 'string' || payload.png.length > 400000 || !payload.png.startsWith('data:image/png;base64,')) return false
    try {
      const icon = nativeImage.createFromDataURL(payload.png)
      const size = icon.getSize()
      if (icon.isEmpty() || size.width !== 256 || size.height !== 256) return false
      mainWindow.setIcon(icon)
      if (process.platform === 'darwin') app.dock?.setIcon(icon)
      fs.mkdirSync(directory, { recursive: true })
      const iconFile = location(payload.accent)
      if (currentAccent !== payload.accent || !fs.existsSync(iconFile)) {
        const png = icon.toPNG()
        fs.writeFileSync(iconFile, pngToIco(png))
        fs.writeFileSync(iconFile.replace(/\.ico$/, '.png'), png)
        fs.writeFileSync(stateFile + '.tmp', JSON.stringify({ accent: payload.accent }))
        fs.renameSync(stateFile + '.tmp', stateFile)
      }
      currentAccent = payload.accent
      // Only our existing shortcut, only if its target is this package/launcher.
      if (process.platform === 'win32' && app.isPackaged && !isolated) {
        const launcher = path.resolve(path.dirname(process.execPath), '..', '..', 'PoseGood.exe')
        const allowed = [executable, launcher].map(p => path.resolve(p).toLowerCase())
        const shortcut = path.join(app.getPath('desktop'), 'PoseGood.lnk')
        if (fs.existsSync(shortcut)) {
          const details = shell.readShortcutLink(shortcut)
          if (allowed.includes(path.resolve(details.target).toLowerCase())) {
            if (!shell.writeShortcutLink(shortcut, 'update', { icon: iconFile, iconIndex: 0 })) return false
          }
        }
      }
      return true
    } catch { return false }
  }
}
module.exports = { installThemeIcon, pngToIco }
