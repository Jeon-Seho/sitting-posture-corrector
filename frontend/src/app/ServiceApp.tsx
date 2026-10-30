import { useCamera } from '../hooks/useCamera'
import { LocalServiceApp } from './LocalServiceApp'
import { ConnectionLostDialog } from '../features/connection/ConnectionLostDialog'
import { CameraPerformanceDialog } from '../features/camera/CameraPerformanceDialog'

export default function ServiceApp() {
  const camera = useCamera()
  return (
    <>
      <LocalServiceApp camera={camera} />
      <ConnectionLostDialog />
      <CameraPerformanceDialog />
    </>
  )
}
