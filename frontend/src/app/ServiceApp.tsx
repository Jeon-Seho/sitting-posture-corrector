import { useCamera } from '../hooks/useCamera'
import { LocalServiceApp } from './LocalServiceApp'

export default function ServiceApp() {
  const camera = useCamera()
  return <LocalServiceApp camera={camera} />
}
