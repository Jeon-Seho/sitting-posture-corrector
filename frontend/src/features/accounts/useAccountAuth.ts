import { useEffect, useRef, useState } from 'react'
import type { AccountUser, AccountWorkspace, Registration } from './contracts'
import { accountClient, accountError, AccountApiError, ACCOUNT_ACCESS_LOST } from './client'

type AuthState = {
  status: 'loading' | 'anonymous' | 'ready' | 'error'
  user: AccountUser | null
  workspace: AccountWorkspace | null
  message: string
}
const anonymous = (message = ''): AuthState => ({
  status: 'anonymous',
  user: null,
  workspace: null,
  message,
})
const BOUNDARY_KEY = 'posegood.account-boundary.v1'

/** No profile/record material is loaded until the server confirms the authenticated identity. */
export function useAccountAuth(stopCapture: () => void) {
  const [state, setState] = useState<AuthState>({ ...anonymous(), status: 'loading' })
  const [busy, setBusy] = useState(false)
  const epoch = useRef(0)
  const currentUser = useRef<string | null>(null)
  const alive = useRef(true)
  const authenticating = useRef(false)
  const stop = useRef(stopCapture)
  stop.current = stopCapture

  function reset(message = '') {
    epoch.current++
    currentUser.current = null
    accountClient.setIdentity(null)
    stop.current()
    setState(anonymous(message))
    setBusy(false)
    authenticating.current = false
  }

  function broadcast() {
    // A nonsensitive change marker promptly stops other tabs sharing this authentication cookie.
    try {
      localStorage.setItem(BOUNDARY_KEY, crypto.randomUUID())
    } catch {
      /* HTTP identity guards still apply. */
    }
  }

  async function restore() {
    const attempt = ++epoch.current
    setState({ ...anonymous(), status: 'loading' })
    try {
      const user = await accountClient.me()
      if (!alive.current || attempt !== epoch.current) return
      accountClient.setIdentity(user.user_id)
      const workspace = await accountClient.workspace()
      if (!alive.current || attempt !== epoch.current) return
      currentUser.current = user.user_id
      setState({ status: 'ready', user, workspace, message: '' })
    } catch (error) {
      if (!alive.current || attempt !== epoch.current) return
      accountClient.setIdentity(null)
      setState(
        anonymous(
          error instanceof AccountApiError && error.status === 401 ? '' : accountError(error),
        ),
      )
    }
  }

  useEffect(() => {
    alive.current = true
    void restore()
    const expired = () =>
      reset('로그인이 만료되었거나 계정이 바뀌었습니다. 측정을 멈췄습니다. 다시 로그인해 주세요.')
    const changed = (event: StorageEvent) => {
      if (event.key === BOUNDARY_KEY) expired()
    }
    const checkIdentity = () => {
      const expected = currentUser.current
      if (!expected || document.hidden) return
      void accountClient
        .me()
        .then((user) => {
          if (alive.current && currentUser.current === expected && user.user_id !== expected)
            expired()
        })
        .catch((error: unknown) => {
          if (
            alive.current &&
            currentUser.current === expected &&
            error instanceof AccountApiError &&
            (error.status === 401 || error.code === 'AUTH_CHANGED')
          )
            expired()
        })
    }
    window.addEventListener(ACCOUNT_ACCESS_LOST, expired)
    window.addEventListener('storage', changed)
    window.addEventListener('focus', checkIdentity)
    const timer = setInterval(checkIdentity, 30000)
    return () => {
      alive.current = false
      epoch.current++
      accountClient.setIdentity(null)
      window.removeEventListener(ACCOUNT_ACCESS_LOST, expired)
      window.removeEventListener('storage', changed)
      window.removeEventListener('focus', checkIdentity)
      clearInterval(timer)
    }
  }, [])

  async function authenticate(email: string, password: string, registration?: Registration) {
    if (authenticating.current) return
    authenticating.current = true
    const attempt = ++epoch.current
    setBusy(true)
    try {
      const user = registration
        ? await accountClient.register(registration)
        : await accountClient.login(email, password)
      if (!alive.current || attempt !== epoch.current) return
      const workspace = await accountClient.workspace()
      if (!alive.current || attempt !== epoch.current) return
      currentUser.current = user.user_id
      broadcast()
      setState({ status: 'ready', user, workspace, message: '' })
    } catch (error) {
      if (alive.current && attempt === epoch.current) setState(anonymous(accountError(error)))
    } finally {
      if (alive.current && attempt === epoch.current) {
        setBusy(false)
        authenticating.current = false
      }
    }
  }

  async function logout() {
    stop.current()
    if (currentUser.current) accountClient.assertIdentity(currentUser.current)
    await accountClient.logout()
    broadcast()
    reset()
  }
  function deleted() {
    broadcast()
    reset('계정과 저장된 기록을 삭제했습니다.')
  }
  function passwordChanged() {
    broadcast()
    reset('비밀번호를 변경했습니다. 새 비밀번호로 다시 로그인해 주세요.')
  }
  return { ...state, busy, authenticate, restore, logout, deleted, passwordChanged }
}
