/** Explicit camera/UI development account. Never submitted to an account server. */
export function isDeveloperAccount(id: string, password: string) {
  return id.trim() === 'admin' && password === '1234'
}
