import { useEffect, useRef } from 'react'
import type { CameraController } from '../../hooks/useCamera'
import { desktopBridge } from './bridge'

/**
 * When the desktop app was started from the OS startup list and the user opted in,
 * connect the camera once the signed-in measure screen is showing. It runs at most once
 * per app start, so turning the camera off afterwards is respected.
 *
 * The personal baseline is not persisted yet, so the user still confirms it before
 * measuring. Once the platform stores baselines (POST /api/baselines, see
 * docs/design/frontend-platform-seams.md), this is the place to restore the saved
 * baseline and start measuring without a click.
 */
export function useLaunchAutomation({ camera, ready }: { camera: CameraController; ready: boolean }) {
  const settled = useRef(false)
  const latest = useRef({ camera, ready })
  latest.current = { camera, ready }
  useEffect(() => {
    if (settled.current || !ready || camera.state !== 'off') return
    const bridge = desktopBridge()
    if (!bridge) return
    bridge
      .getLaunchInfo()
      .then((info) => {
        if (settled.current) return
        if (!info?.launchedAtLogin || !info.autoCamera) {
          settled.current = true
          return
        }
        const now = latest.current
        if (!now.ready || now.camera.state !== 'off') return
        settled.current = true
        void now.camera.connect()
      })
      .catch(() => {
        settled.current = true
      })
  }, [ready, camera.state])
}
