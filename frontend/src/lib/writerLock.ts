export type WriterState = 'checking' | 'ready' | 'busy' | 'unavailable'

/** One writer per browser origin. The browser releases the lock when the tab closes. */
export function claimWriter(locks: Pick<LockManager, 'request'> | undefined, update: (state: WriterState) => void) {
  let disposed = false, unlock: (() => void) | undefined
  if (!locks) { update('unavailable'); return Object.assign(() => {}, { finished: Promise.resolve() }) }
  const finished = locks.request('posegood.v2.writer', { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (disposed) return
    if (!lock) { update('busy'); return }
    update('ready')
    await new Promise<void>(resolve => { unlock = resolve })
  }).catch(() => { if (!disposed) update('unavailable') })
  return Object.assign(() => { disposed = true; unlock?.() }, { finished })
}
