/**
 * What the signed-in account gives every write to the API (BE api-spec 1장): the CSRF token
 * for `X-CSRF-TOKEN` and the user id for `X-PoseGood-User-Id`.
 *
 * The account client (`features/auth/accountClient.ts`, F12) calls `setServerAuth` after
 * sign-in, sign-up and `me`, and `null` after sign-out; anything that depends on the account
 * can `subscribeServerAuth` to reload. Signed out, server calls report that sign-in is needed.
 */
export type ServerAuth = {
  userId: string
  /**
   * The CSRF token (A1) the caller sends on POST·PUT·DELETE. `fresh` drops the cached one and
   * asks the server again (after a 403 `ACCESS_DENIED`).
   */
  csrfToken: (fresh?: boolean) => Promise<string>
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
