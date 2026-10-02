import { useCamera } from '../hooks/useCamera'
import { LocalServiceApp } from './LocalServiceApp'
import { AccountApp } from '../features/accounts/AccountApp'
import { SERVER_ACCOUNTS } from '../features/accounts/client'

export default function ServiceApp() {
  const camera = useCamera()
  return SERVER_ACCOUNTS ? <AccountApp camera={camera} /> : <LocalServiceApp camera={camera} />
}
