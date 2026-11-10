const fs = require('node:fs')
const path = require('node:path')

function validateAppearance(value) {
  if (!value || !['light', 'dark', 'gray', 'system'].includes(value.mode) ||
      typeof value.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.accent)) return null
  return { mode: value.mode, accent: value.accent.toLowerCase() }
}

function fallbackAppearance(app) {
  const file = path.join(app.getPath('userData'), 'fallback-appearance.json')
  let current = null
  try { current = validateAppearance(JSON.parse(fs.readFileSync(file, 'utf8'))) } catch { /* First launch. */ }
  return {
    save(value) {
      const next = validateAppearance(value)
      if (!next) return false
      if (JSON.stringify(current) === JSON.stringify(next)) return true
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(next))
        current = next
        return true
      } catch { return false }
    },
    url(address) {
      const url = new URL(address)
      if (current) {
        url.searchParams.set('mode', current.mode)
        url.searchParams.set('accent', current.accent)
      }
      return url.href
    },
  }
}
module.exports = { fallbackAppearance, validateAppearance }
