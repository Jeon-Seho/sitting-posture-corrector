import type { CameraController } from '../../hooks/useCamera'
import ObservationLab from './ObservationLab'

/** The sole /dev entry: isolated observation, guidance and keypoint replay. */
export default function DeveloperRoute({ camera }: { camera: CameraController }) {
  const search = typeof window === 'undefined' ? '' : window.location?.search ?? ''
  const demo = new URLSearchParams(search).get('demo') === '1'
  return <ObservationLab key={demo ? 'demo' : 'camera'} camera={camera} demo={demo} />
}
