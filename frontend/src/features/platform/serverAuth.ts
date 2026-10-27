/**
 * What the signed-in account gives every call to the API (BE api-spec 1장, BE ADR 0031): the
 * access token for `Authorization: Bearer` and the user id for `X-PoseGood-User-Id`.
 *
 * The account client (`features/auth/accountClient.ts`, F12) calls `setServerAuth` after
 * sign-in, sign-up and the start-up refresh, and `null` after sign-out; anything that depends on
 * the account can `subscribeServerAuth` to reload. Signed out, server calls report that sign-in
 * is needed.
 */
export type ServerAuth = {
  userId: string
  /**
   * The access token (kept in memory only). It is renewed first when it ends within a minute or
   * two; `fresh` renews it anyway (after a 401). Rejects when the login is over.
   */
  accessToken: (fresh?: boolean) => Promise<string>
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
