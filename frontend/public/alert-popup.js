// Fills the popup from the main process and sends the two button actions back.
// `window.posegoodPopup` comes from electron/popup-preload.cjs; outside Electron nothing happens.
;(() => {
  const bridge = window.posegoodPopup
  if (!bridge) return
  const popup = document.querySelector('.popup')
  const bar = document.getElementById('timer-bar')
  bridge.onShow(({ title, body, durationMs }) => {
    document.getElementById('title').textContent = title
    document.getElementById('body').textContent = body
    popup.classList.remove('leaving')
    bar.classList.remove('running')
    bar.style.setProperty('--duration', `${durationMs}ms`)
    // Restart the countdown animation for a repeated alert.
    void bar.offsetWidth
    bar.classList.add('running')
  })
  bridge.onHide(() => popup.classList.add('leaving'))
  document.getElementById('open').addEventListener('click', () => bridge.openApp())
  document.getElementById('close').addEventListener('click', () => bridge.close())
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') bridge.close()
  })
})()
