/**
 * What the signed-in account gives every write to the API (BE api-spec 1장): the CSRF token
 * for `X-CSRF-TOKEN` and the user id for `X-PoseGood-User-Id`.
 *
 * Connecting the app's sign-in to `/v2/auth` is BE work (F12, 2026-10-21). Until that lands
 * nothing is registered here and server calls report that sign-in is needed. The BE sign-in
 * code calls `setServerAuth` after login (and `null` after logout); anything that depends on
 * the account can `subscribeServerAuth` to reload.
 */
export type ServerAuth = {
  userId: string
  /** A fresh token after login/logout (A1); the caller sends it on POST·PUT·DELETE. */
  csrfToken: () => Promise<string>
}

let current: ServerAuth | null = null
const listeners = new Set<() => void>()

export function getServerAuth(): ServerAuth | null {
  return current
}

export function setServerAuth(auth: ServerAuth | null) {
  current = auth
  for (const listener of listeners) listener()
}

export function subscribeServerAuth(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
