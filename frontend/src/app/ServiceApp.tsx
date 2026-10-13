import { useCamera } from '../hooks/useCamera'
import { LocalServiceApp } from './LocalServiceApp'
import { AccountApp } from '../features/accounts/AccountApp'
import { SERVER_ACCOUNTS } from '../features/accounts/client'
import { ConnectionLostDialog } from '../features/connection/ConnectionLostDialog'

export default function ServiceApp() {
  const camera = useCamera()
  return (
    <>
      {SERVER_ACCOUNTS ? <AccountApp camera={camera} /> : <LocalServiceApp camera={camera} />}
      <ConnectionLostDialog />
    </>
  )
}
