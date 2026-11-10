// The standalone host/desktop fallbacks also work when React cannot load.
(() => {
  try {
    const appearance = JSON.parse(localStorage.getItem('posegood.appearance.v1') || 'null')
    const palettes = { '#18794e': 'green', '#c4532a': 'peach', '#2864c8': 'black', '#087f8c': 'black', '#525963': 'black', '#242424': 'black', '#5865f2': 'discord' }
    const palette = palettes[appearance?.accent?.toLowerCase()] || 'green'
    const assetRoot = new URL('.', document.currentScript.src)
    document.querySelectorAll('img[data-error-code]').forEach(image => {
      image.src = new URL(`illustrations/themes/${palette}-error-${image.dataset.errorCode}.webp`, assetRoot).href
    })
    const dark = appearance?.mode === 'dark' || ((!appearance || appearance.mode === 'system') && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.style.setProperty('--bg', dark ? '#181a1d' : '#f6f7f9')
    document.documentElement.style.setProperty('--ink', dark ? '#f3f4f5' : '#202b33')
    document.documentElement.style.setProperty('--text', dark ? '#f3f4f5' : '#202b33')
    document.documentElement.style.setProperty('--muted', dark ? '#b6bbc2' : '#5c6670')
  } catch { /* Storage may be unavailable on the desktop loading page; retain the defaults. */ }
})()
