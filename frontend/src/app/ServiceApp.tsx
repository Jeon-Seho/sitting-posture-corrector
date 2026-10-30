import { lazy, Suspense, useEffect, useState } from 'react'
import { useCamera } from '../hooks/useCamera'
import { LocalServiceApp } from './LocalServiceApp'
import { ConnectionLostDialog } from '../features/connection/ConnectionLostDialog'
import { CameraPerformanceDialog } from '../features/camera/CameraPerformanceDialog'
import { ForecastPage } from '../pages/ForecastPage'

const DeveloperRoute = lazy(() => import('../features/developer/DeveloperRoute'))
export const isDeveloperPath = (path: string) => /^\/dev\/?$/.test(path)
const route = (): 'service' | 'developer' | 'forecast' => {
  if (typeof window === 'undefined') return 'service'
  if (isDeveloperPath(window.location?.pathname ?? '/')) return 'developer'
  return window.location?.hash === '#forecast' ? 'forecast' : 'service'
}

function ServiceCameraApp() {
  const camera = useCamera()
  return <><LocalServiceApp camera={camera} /><ConnectionLostDialog /><CameraPerformanceDialog /></>
}

function ResearchCameraApp({ kind }: { kind: 'developer' | 'forecast' }) {
  const camera = useCamera({ baselineMode: 'local' })
  return <>{kind === 'developer' ? <Suspense fallback={<p role="status">관측 화면을 불러오고 있어요.</p>}><DeveloperRoute camera={camera} /></Suspense> : <ForecastPage camera={camera} />}<CameraPerformanceDialog /></>
}

/** Service and research share tracking while their baseline storage remains separate. */
export default function ServiceApp() {
  const [current, setCurrent] = useState(route)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setCurrent(route())
    window.addEventListener('popstate', update)
    window.addEventListener('hashchange', update)
    return () => { window.removeEventListener('popstate', update); window.removeEventListener('hashchange', update) }
  }, [])
  return current === 'service' ? <ServiceCameraApp /> : <ResearchCameraApp key={current} kind={current} />
}
