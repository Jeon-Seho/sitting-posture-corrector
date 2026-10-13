import { useEffect, useState } from 'react'
import { useCamera } from '../hooks/useCamera'
import { LocalServiceApp } from './LocalServiceApp'
import { AccountApp } from '../features/accounts/AccountApp'
import { SERVER_ACCOUNTS } from '../features/accounts/client'
import { ForecastPage } from '../pages/ForecastPage'

export default function ServiceApp() {
  const camera = useCamera()
  const [forecast, setForecast] = useState(() => window.location?.hash === '#forecast')
  useEffect(() => {
    const change = () => setForecast(window.location?.hash === '#forecast')
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  if (forecast) return <ForecastPage camera={camera} />
  return SERVER_ACCOUNTS ? <AccountApp camera={camera} /> : <LocalServiceApp camera={camera} />
}
