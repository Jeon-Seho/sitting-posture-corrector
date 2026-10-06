// Fills the popup from the main process and sends the user's choice back.
// `window.posegoodPopup` comes from electron/popup-preload.cjs; outside Electron nothing happens.
;(() => {
  const bridge = window.posegoodPopup
  if (!bridge) return
  const popup = document.querySelector('.popup')
  const bar = document.getElementById('timer-bar')
  // A horizontal drag past this distance (or a quick flick) swipes the popup away.
  const SWIPE_PX = 90
  const FLICK_PX_PER_MS = 0.6
  const CLICK_SLOP_PX = 6
  let drag = null
  let dragged = false

  const restart = (element, name) => {
    element.classList.remove(name)
    void element.offsetWidth // Restart the CSS animation for a repeated alert.
    element.classList.add(name)
  }
  const reset = () => {
    popup.classList.remove('dragging', 'snapping', 'swiped')
    popup.style.removeProperty('--dx')
    popup.style.removeProperty('--fade')
  }
  // The card follows the pointer sideways and fades the farther it goes.
  const move = (dx, fade = Math.max(0.25, 1 - Math.abs(dx) / 260)) => {
    popup.style.setProperty('--dx', `${dx}px`)
    popup.style.setProperty('--fade', String(fade))
  }

  popup.addEventListener('animationend', (event) => {
    if (event.animationName !== 'rise') return
    popup.classList.remove('entering')
    popup.classList.add('shown')
  })
  bridge.onShow(({ title, body, durationMs }) => {
    document.getElementById('title').textContent = title
    document.getElementById('body').textContent = body
    reset()
    popup.classList.remove('leaving', 'shown')
    restart(popup, 'entering')
    bar.style.setProperty('--duration', `${durationMs}ms`)
    restart(bar, 'running')
  })
  bridge.onHide(() => {
    popup.classList.remove('entering', 'shown')
    popup.classList.add('leaving')
  })

  // Swipe left or right to dismiss; a short press without movement still opens the app.
  popup.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('#close') || !popup.classList.contains('shown')) return
    drag = { id: event.pointerId, x: event.clientX, at: performance.now(), dx: 0 }
    dragged = false
    popup.classList.remove('snapping')
  })
  popup.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return
    drag.dx = event.clientX - drag.x
    if (!dragged && Math.abs(drag.dx) < CLICK_SLOP_PX) return
    if (!dragged) {
      dragged = true
      popup.setPointerCapture(event.pointerId)
      popup.classList.add('dragging')
    }
    move(drag.dx)
  })
  const release = (event) => {
    if (!drag || event.pointerId !== drag.id) return
    const { dx, at } = drag
    drag = null
    if (!dragged) return
    popup.classList.remove('dragging')
    const speed = Math.abs(dx) / Math.max(1, performance.now() - at)
    if (Math.abs(dx) >= SWIPE_PX || speed >= FLICK_PX_PER_MS) {
      // Glide a little further in the same direction while fading out.
      move(dx + (dx < 0 ? -60 : 60), 0)
      popup.classList.add('swiped')
      setTimeout(() => bridge.close(true), 240)
    } else {
      popup.classList.add('snapping')
      move(0, 1)
    }
  }
  popup.addEventListener('pointerup', release)
  popup.addEventListener('pointercancel', release)

  // The whole card opens the app unless it was dragged; only the close button dismisses it.
  popup.addEventListener('click', () => {
    if (dragged) {
      dragged = false
      return
    }
    bridge.openApp()
  })
  document.getElementById('close').addEventListener('click', (event) => {
    event.stopPropagation()
    bridge.close()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') bridge.close()
  })
})()
