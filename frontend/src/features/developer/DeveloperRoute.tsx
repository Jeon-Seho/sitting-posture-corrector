import { useEffect } from 'react'
import type { CameraController } from '../../hooks/useCamera'
import DeveloperLab from './DeveloperLab'
import { useDeveloperSession } from './useDeveloperSession'

/** A separate research surface: it never creates a user profile or service session. */
export default function DeveloperRoute({ camera }: { camera: CameraController }) {
  const session = useDeveloperSession(camera)
  useEffect(() => {
    const previous = document.title
    document.title = 'Posture Lab · PoseGood'
    return () => { document.title = previous }
  }, [])
  return <>
    <video ref={camera.videoRef} className="capture-source" muted playsInline aria-hidden="true" />
    <DeveloperLab camera={camera} session={session} />
  </>
}
