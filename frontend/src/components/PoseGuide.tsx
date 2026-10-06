import { useEffect, useRef, useState } from 'react'
import type { Landmark } from '../../../model/prototype/pose'
import type { CameraController } from '../hooks/useCamera'
import { defaultGuide, fittedGuide, smoothPoints, type GuideShape } from '../lib/poseGuide'

/** Re-render at most this often; detection runs faster than the guide needs to move. */
const GUIDE_INTERVAL_MS = 100

/**
 * Head/shoulder guide over the preview. It starts at a default placement and then follows the
 * detected person at their own size, so any camera distance works. It is only a hint: readiness
 * comes from face/shoulder quality, not from fitting this outline.
 */
export function PoseGuide({ camera }: { camera: CameraController }) {
  const [shape, setShape] = useState<GuideShape>(() => defaultGuide())
  const points = useRef<Landmark[] | null>(null)
  const last = useRef(0)
  useEffect(
    () =>
      camera.subscribe((observation) => {
        const now = observation.timeMs
        const smoothed = smoothPoints(points.current, observation.landmarks)
        points.current = smoothed
        if (now - last.current < GUIDE_INTERVAL_MS) return
        last.current = now
        setShape(
          fittedGuide(smoothed, observation.width, observation.height) ??
            defaultGuide(observation.width, observation.height),
        )
      }),
    [camera.subscribe],
  )
  return (
    <svg
      className={`stage-guide${shape.fitted ? ' fitted' : ''}`}
      viewBox={`0 0 ${shape.width} ${shape.height}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <ellipse cx={shape.head.cx} cy={shape.head.cy} rx={shape.head.rx} ry={shape.head.ry} />
      <path d={shape.shoulders} />
    </svg>
  )
}
