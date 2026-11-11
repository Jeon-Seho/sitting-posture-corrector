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
  // 웹 화면이 아직 테마를 넘기지 않았으면 바탕화면 아이콘에 쓴 색(theme-icons)을 따른다. 아이콘과 시작 화면 색을 맞춘다.
  if (!current) {
    try {
      const { accent } = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'theme-icons', 'current.json'), 'utf8'))
      current = validateAppearance({ mode: 'system', accent })
    } catch { /* No icon state yet: use the default green. */ }
  }
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
    /** 창을 처음 그릴 색조. 저장값이 없거나 'system'이면 운영체제 설정을 따른다. */
    accent() { return current?.accent ?? '#18794e' },
    tone(systemDark) {
      if (current?.mode === 'light' || current?.mode === 'gray' || current?.mode === 'dark') return current.mode
      return systemDark ? 'dark' : 'light'
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
