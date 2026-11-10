// Works without React and without access to the website's storage in app:// fallback pages.
(() => {
  const script = document.currentScript
  const params = new URLSearchParams(location.search)
  const valid = value => value && ['light', 'dark', 'gray', 'system'].includes(value.mode) && /^#[0-9a-f]{6}$/i.test(value.accent)
  const supplied = { mode: params.get('mode'), accent: params.get('accent') }
  let appearance = valid(supplied) ? supplied : null
  if (!appearance) {
    try {
      const stored = JSON.parse(localStorage.getItem('posegood.appearance.v1') || 'null')
      if (valid(stored)) appearance = stored
    } catch { /* Blocked storage must not prevent the fallback from rendering. */ }
  }
  appearance ||= { mode: 'system', accent: '#18794e' }
  function apply() {
    const accent = appearance.accent.toLowerCase()
    const palettes = { '#18794e': 'green', '#c4532a': 'peach', '#2864c8': 'black', '#087f8c': 'black', '#525963': 'black', '#242424': 'black', '#5865f2': 'discord' }
    const palette = palettes[accent] || 'green'
    const dark = appearance.mode === 'dark' || (appearance.mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    const tone = dark ? 'dark' : appearance.mode === 'gray' ? 'gray' : 'light'
    const colors = dark
      ? accent === '#242424' ? ['#101010', '#f5f5f5', '#b5b5b5'] : accent === '#5865f2' ? ['#1e1f22', '#f2f3f5', '#b5bac1'] : ['#131920', '#f0f4f8', '#aebdcd']
      : tone === 'gray' ? ['#c7cbd1', '#202833', '#4a5667'] : accent === '#c4532a' ? ['#fbf5ee', '#2e241f', '#7c6b61'] : ['#f6f7f9', '#202b33', '#61707b']
    const root = document.documentElement
    root.dataset.theme = tone
    root.dataset.palette = palette
    root.style.colorScheme = dark ? 'dark' : 'light'
    for (const [name, color] of Object.entries({ '--bg': colors[0], '--ink': colors[1], '--text': colors[1], '--muted': colors[2], '--accent': accent })) root.style.setProperty(name, color)
    const rgb = accent.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    const luminance = rgb.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    root.style.setProperty('--on-accent', (1.05 / (luminance + 0.05)) >= ((luminance + 0.05) / 0.05) ? '#ffffff' : '#000000')
    const assetRoot = new URL('.', script.src)
    document.querySelectorAll('img[data-error-code]').forEach(image => {
      image.src = new URL(`illustrations/themes/${palette}-error-${image.dataset.errorCode}.webp`, assetRoot).href
    })
  }
  apply()
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply)
  window.addEventListener('storage', event => {
    if (event.key !== 'posegood.appearance.v1' || valid(supplied)) return
    try { const next = JSON.parse(event.newValue); if (valid(next)) { appearance = next; apply() } } catch { /* Retain last valid theme. */ }
  })
})()
