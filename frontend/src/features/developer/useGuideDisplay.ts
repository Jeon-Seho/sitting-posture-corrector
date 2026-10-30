import { useEffect, useRef, useState } from 'react'
import { GuideDisplayFilter } from './displaySmoothing'
import type { LabGuideFrame } from './types'

export function useGuideDisplay(frame: LabGuideFrame | null) {
  const filter = useRef(new GuideDisplayFilter())
  const [displayed, setDisplayed] = useState<LabGuideFrame | null>(frame)
  useEffect(() => { setDisplayed(filter.current.update(frame)) }, [frame])
  // Never leave stale points visible while effects catch up with a lost observation.
  return frame ? displayed : null
}
