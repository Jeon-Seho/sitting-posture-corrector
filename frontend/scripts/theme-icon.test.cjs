const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { installThemeIcon, pngToIco } = require('../electron/theme-icon.cjs')

test('ICO points at the PNG entry with a 256px size marker', () => {
  const png = Buffer.from('synthetic PNG data')
  const ico = pngToIco(png)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 1)
  assert.equal(ico[6], 0)
  assert.equal(ico.readUInt32LE(14), png.length)
  assert.equal(ico.readUInt32LE(18), 22)
  assert.deepEqual(ico.subarray(22), png)
})
test('persists a validated icon, restores on restart and preserves a shortcut pointing elsewhere', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posegood-icon-test-'))
  try {
    let updated = 0, displayed = 0, loaded = ''
    const icon = { isEmpty: () => false, getSize: () => ({ width: 256, height: 256 }), toPNG: () => Buffer.from('synthetic') }
    const options = {
      app: { isPackaged: true, getPath: () => directory },
      nativeImage: { createFromDataURL: () => icon, createFromPath: p => { loaded = p; return icon } },
      mainWindow: { setIcon: () => displayed++ },
      shell: { readShortcutLink: () => ({ target: 'C:/unrelated.exe' }), writeShortcutLink: () => { updated++; return true } },
      executable: 'C:/posegood/PoseGood.exe', isolated: false,
    }
    fs.writeFileSync(path.join(directory, 'PoseGood.lnk'), 'synthetic')
    const apply = installThemeIcon(options)
    assert.equal(apply({ accent: '../../bad', png: 'data:image/png;base64,AAAA' }), false)
    assert.equal(apply({ accent: '#5865f2', png: 'data:image/png;base64,AAAA' }), true)
    assert.equal(updated, 0)
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'theme-icons/current.json'))).accent, '#5865f2')
    installThemeIcon(options)
    assert.ok(loaded.endsWith('5865f2.png'))
    assert.equal(displayed, 2)
    options.shell.readShortcutLink = () => ({ target: options.executable })
    assert.equal(apply({ accent: '#5865f2', png: 'data:image/png;base64,AAAA' }), true)
    if (process.platform === 'win32') assert.equal(updated, 1)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
