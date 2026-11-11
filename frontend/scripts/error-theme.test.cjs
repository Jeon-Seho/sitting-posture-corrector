const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { fallbackAppearance } = require('../electron/fallback-appearance.cjs')
const source = fs.readFileSync(path.join(__dirname, '../public/error-theme.js'), 'utf8')

function render({ stored, query = '', blocked = false, systemDark = false } = {}) {
  const values = {}, images = [{ dataset: { errorCode: '504' } }, { dataset: { errorCode: '502' } }]
  const root = { dataset: {}, style: { setProperty: (name, value) => { values[name] = value } } }
  const listeners = {}
  vm.runInNewContext(source, {
    URL, URLSearchParams,
    location: { search: query },
    document: { currentScript: { src: 'app://posegood/error-theme.js' }, documentElement: root, querySelectorAll: () => images },
    localStorage: { getItem: () => { if (blocked) throw Error('blocked'); return JSON.stringify(stored ?? null) } },
    matchMedia: () => ({ matches: systemDark, addEventListener: () => {} }),
    window: { addEventListener: (name, listener) => { listeners[name] = listener } },
  })
  return { values, images, root, listeners }
}

test('all seven palettes and four modes use the matching error artwork and readable actions', () => {
  const accents = { '#18794e': 'green', '#c4532a': 'peach', '#2864c8': 'black', '#087f8c': 'black', '#525963': 'black', '#242424': 'black', '#5865f2': 'discord' }
  for (const [accent, palette] of Object.entries(accents)) for (const mode of ['light', 'dark', 'gray', 'system']) {
    const result = render({ stored: { accent, mode }, systemDark: true })
    assert.equal(result.root.dataset.palette, palette)
    assert.equal(result.root.dataset.theme, mode === 'system' ? 'dark' : mode)
    assert.equal(result.values['--accent'], accent)
    assert.equal(result.images[1].src, `app://posegood/illustrations/themes/${palette}-error-502.webp`)
    assert.ok(['#ffffff', '#000000'].includes(result.values['--on-accent']))
  }
})

test('desktop theme survives restart and reaches the local fallback despite blocked or different-origin storage', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posegood-theme-'))
  try {
    const app = { getPath: () => directory }
    const first = fallbackAppearance(app)
    assert.equal(first.save({ mode: 'dark', accent: '#5865f2' }), true)
    assert.equal(first.save({ mode: 'dark', accent: 'bad' }), false)
    const next = fallbackAppearance(app)
    const url = new URL(next.url('app://posegood/offline.html?state=offline'))
    assert.equal(url.searchParams.get('state'), 'offline')
    const result = render({ query: url.search, blocked: true })
    assert.equal(result.root.dataset.theme, 'dark')
    assert.equal(result.root.dataset.palette, 'discord')
    assert.equal(result.values['--bg'], '#1e1f22')
    assert.equal(result.values['--on-accent'], '#ffffff')
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(directory).startsWith('posegood-theme-'))
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('broken storage falls back safely and a valid storage update changes the preview', () => {
  assert.equal(render({ blocked: true }).root.dataset.palette, 'green')
  const result = render()
  result.listeners.storage({ key: 'posegood.appearance.v1', newValue: JSON.stringify({ mode: 'light', accent: '#c4532a' }) })
  assert.equal(result.root.dataset.palette, 'peach')
  assert.equal(result.values['--bg'], '#fbf5ee')
})
