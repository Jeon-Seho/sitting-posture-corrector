/**
 * The frame loop's timer. Chrome slows `setTimeout` in a hidden tab to about once a second, which
 * stopped measuring on another tab ("영상 멈춤"). A worker's timer is not slowed: 2026-10-26 Chrome 156,
 * camera only, 456 s hidden — worker 30.3 frames/s (longest gap 218 ms), setTimeout 1.0 (plan 0054).
 * One tick per request, like a chained `setTimeout`, so a slow frame never queues extra ticks.
 */
export type FrameTimer = { next: (delayMs: number, tick: () => void) => void; stop: () => void }

const WORKER_SOURCE = 'onmessage = (event) => { setTimeout(() => postMessage(0), event.data) }'

export function createFrameTimer(): FrameTimer {
  let pending: (() => void) | null = null
  let worker: Worker | null = null
  try {
    if (typeof Worker !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
      worker = new Worker(url)
      URL.revokeObjectURL(url)
      worker.onmessage = () => {
        const tick = pending
        pending = null
        tick?.()
      }
    }
  } catch (caughtError) {
    console.error('[features/camera/frameTimer.ts:createFrameTimer] Operation failed', caughtError)
    worker = null
  }
  if (!worker) {
    // No workers (tests, unusual browsers): the old timer, which slows down in a hidden tab.
    let timer: ReturnType<typeof setTimeout> | null = null
    return {
      next: (delayMs, tick) => { timer = setTimeout(tick, delayMs) },
      stop: () => { if (timer !== null) clearTimeout(timer) },
    }
  }
  const running = worker
  return {
    next: (delayMs, tick) => {
      pending = tick
      running.postMessage(delayMs)
    },
    stop: () => {
      pending = null
      running.terminate()
    },
  }
}
