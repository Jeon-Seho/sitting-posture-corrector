/**
 * Browser storage keys lost their version on 2026-11-18 (`posegood.v2.*` → `posegood.*`,
 * ADR 0049, FE proposal 할 일 8). A value saved under the old name moves once to the new name so
 * the camera choice, tracking rate and old local data survive the rename. Runs before the app
 * reads storage (main.tsx).
 */
export const RENAMED_KEYS: readonly (readonly [old: string, current: string])[] = [
  ['posegood.v2.profile', 'posegood.profile'],
  ['posegood.v2.records', 'posegood.records'],
  ['posegood.v2.draft', 'posegood.draft'],
  ['posegood.v2.settings', 'posegood.settings'],
  ['posegood.v2.demo', 'posegood.demo'],
  ['posegood.v2.account', 'posegood.account'],
  ['posegood.v2.mainCamera', 'posegood.mainCamera'],
  ['posegood.v2.trackingFps', 'posegood.trackingFps'],
]

type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function browserStorage(): KeyStore | undefined {
  try {
    return globalThis.localStorage
  } catch (caughtError) {
    console.error('[features/storage/renamedKeys.ts:browserStorage] Operation failed', caughtError)
    return undefined
  }
}

/**
 * Copies each old value to its new key unless the new key already has one (a newer write wins),
 * then removes the old key. If the copy fails (storage full or blocked) the old key stays, so
 * nothing is lost and the move is tried again on the next start.
 */
export function moveRenamedKeys(storage: KeyStore | undefined = browserStorage()) {
  if (!storage) return
  for (const [old, current] of RENAMED_KEYS) {
    try {
      const value = storage.getItem(old)
      if (value === null) continue
      if (storage.getItem(current) === null) storage.setItem(current, value)
      storage.removeItem(old)
    } catch (caughtError) {
      console.error('[features/storage/renamedKeys.ts:moveRenamedKeys] Operation failed', caughtError)
    }
  }
}
