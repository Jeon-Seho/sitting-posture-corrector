// Fills the popup from the main process and sends the user's choice back.
// `window.posegoodPopup` comes from electron/popup-preload.cjs; outside Electron nothing happens.
;(() => {
  const bridge = window.posegoodPopup
  if (!bridge) return
  const popup = document.querySelector('.popup')
  const bar = document.getElementById('timer-bar')
  const restart = (element, name) => {
    element.classList.remove(name)
    void element.offsetWidth // Restart the CSS animation for a repeated alert.
    element.classList.add(name)
  }
  popup.addEventListener('animationend', (event) => {
    if (event.animationName !== 'rise') return
    popup.classList.remove('entering')
    popup.classList.add('shown')
  })
  bridge.onShow(({ title, body, durationMs }) => {
    document.getElementById('title').textContent = title
    document.getElementById('body').textContent = body
    popup.classList.remove('leaving', 'shown')
    restart(popup, 'entering')
    bar.style.setProperty('--duration', `${durationMs}ms`)
    restart(bar, 'running')
  })
  bridge.onHide(() => {
    popup.classList.remove('entering', 'shown')
    popup.classList.add('leaving')
  })
  // The whole card opens the app; only the close button dismisses it.
  popup.addEventListener('click', () => bridge.openApp())
  document.getElementById('close').addEventListener('click', (event) => {
    event.stopPropagation()
    bridge.close()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') bridge.close()
  })
})()
