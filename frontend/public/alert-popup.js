// Fills the popup from the main process and sends its actions back.
// `window.posegoodPopup` comes from electron/popup-preload.cjs; outside Electron nothing happens.
// Click opens the app, X or Escape closes, and a sideways swipe (either way) dismisses it.
;(() => {
  const bridge = window.posegoodPopup
  if (!bridge) return
  const pill = document.querySelector('.pill')
  const ring = document.getElementById('ring-time')
  const SWIPE = 70

  function reset() {
    pill.classList.remove('leaving', 'dragging')
    pill.style.transform = ''
    pill.style.opacity = ''
  }

  function applyTheme(theme) {
    if (!theme) return
    const keys = { background: '--snack', text: '--snack-ink', muted: '--snack-muted', accent: '--ring', track: '--ring-track' }
    for (const [key, token] of Object.entries(keys)) {
      if (typeof theme[key] === 'string' && /^#[0-9a-f]{6}$/i.test(theme[key])) document.documentElement.style.setProperty(token, theme[key])
    }
    document.documentElement.dataset.dark = String(theme.dark === true)
  }
  bridge.onTheme?.(applyTheme)
  bridge.onShow(({ title, body, durationMs, theme }) => {
    applyTheme(theme)
    document.getElementById('title').textContent = title
    document.getElementById('body').textContent = body
    reset()
    ring.classList.remove('running')
    ring.style.setProperty('--duration', `${durationMs}ms`)
    // Restart the countdown for a repeated alert.
    void ring.getBoundingClientRect()
    ring.classList.add('running')
  })
  bridge.onHide(() => pill.classList.add('leaving'))

  let startX = null
  let dx = 0
  let moved = false
  pill.addEventListener('pointerdown', (event) => {
    if (event.target.closest('#close')) return
    startX = event.clientX
    dx = 0
    moved = false
    pill.setPointerCapture(event.pointerId)
    pill.classList.add('dragging')
  })
  pill.addEventListener('pointermove', (event) => {
    if (startX === null) return
    dx = event.clientX - startX
    if (Math.abs(dx) > 4) moved = true
    pill.style.transform = `translateX(${dx}px)`
    pill.style.opacity = String(1 - Math.min(Math.abs(dx) / 220, 0.7))
  })
  const release = () => {
    if (startX === null) return
    startX = null
    pill.classList.remove('dragging')
    if (Math.abs(dx) > SWIPE) {
      // Slide off the way it was pushed, then close.
      pill.style.transform = `translateX(${dx > 0 ? 420 : -420}px)`
      pill.style.opacity = '0'
      setTimeout(() => bridge.close(), 180)
      return
    }
    reset()
    if (!moved) bridge.openApp()
  }
  pill.addEventListener('pointerup', release)
  pill.addEventListener('pointercancel', release)
  document.getElementById('close').addEventListener('click', (event) => {
    event.stopPropagation()
    bridge.close()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') bridge.close()
    if (event.key === 'Enter') bridge.openApp()
  })
})()
