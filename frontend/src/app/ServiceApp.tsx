import { useCamera } from '../hooks/useCamera'
import { LocalServiceApp } from './LocalServiceApp'
import { ConnectionLostDialog } from '../features/connection/ConnectionLostDialog'

export default function ServiceApp() {
  const camera = useCamera()
  return (
    <>
      <LocalServiceApp camera={camera} />
      <ConnectionLostDialog />
    </>
  )
}
