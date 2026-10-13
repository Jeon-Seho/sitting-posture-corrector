import { lazy, Suspense, useEffect, useState } from 'react'
import { useCamera } from '../hooks/useCamera'
import { LocalServiceApp } from './LocalServiceApp'
import { AccountApp } from '../features/accounts/AccountApp'
import { SERVER_ACCOUNTS } from '../features/accounts/client'
import { ForecastPage } from '../pages/ForecastPage'

const DeveloperRoute = lazy(() => import('../features/developer/DeveloperRoute'))
export const isDeveloperPath = (path: string) => /^\/dev\/?$/.test(path)

export default function ServiceApp() {
  const camera = useCamera()
  const [forecast, setForecast] = useState(() => window.location?.hash === '#forecast')
  const [developer, setDeveloper] = useState(() => isDeveloperPath(window.location?.pathname ?? '/'))
  useEffect(() => {
    const change = () => {
      setForecast(window.location?.hash === '#forecast')
      setDeveloper(isDeveloperPath(window.location?.pathname ?? '/'))
    }
    window.addEventListener('hashchange', change)
    window.addEventListener('popstate', change)
    return () => {
      window.removeEventListener('hashchange', change)
      window.removeEventListener('popstate', change)
    }
  }, [])
  if (developer) return <Suspense fallback={<p role="status">개발자 실험실을 준비하고 있어요…</p>}><DeveloperRoute camera={camera} /></Suspense>
  if (forecast) return <ForecastPage camera={camera} />
  return SERVER_ACCOUNTS ? <AccountApp camera={camera} /> : <LocalServiceApp camera={camera} />
}
