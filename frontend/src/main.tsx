import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import App from './app/ServiceApp'
import { AppErrorBoundary } from './pages/ErrorPage'
import { markDesktopShell } from './features/desktop/bridge'
import { TitleBar } from './features/desktop/TitleBar'
import { TipLayer } from './components/TipLayer'
import './styles.css'
import { initializeAppearance } from './features/appearance/theme'

initializeAppearance()

async function start() {
  if (import.meta.env.DEV && import.meta.env.MODE === 'browser-smoke') {
    const { installSyntheticBrowser } = await import('./features/testing/bootstrap')
    installSyntheticBrowser()
  }
  markDesktopShell()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TitleBar />
      <AppErrorBoundary><App /></AppErrorBoundary>
      <TipLayer />
    </StrictMode>,
  )
}

void start()
