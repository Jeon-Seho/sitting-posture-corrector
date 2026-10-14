import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import App from './app/ServiceApp'
import { markDesktopShell } from './features/desktop/bridge'
import { TitleBar } from './features/desktop/TitleBar'
import { TipLayer } from './components/TipLayer'
import './styles.css'

async function start() {
  if (import.meta.env.DEV && import.meta.env.MODE === 'browser-smoke') {
    const { installSyntheticBrowser } = await import('./features/testing/bootstrap')
    installSyntheticBrowser()
  }
  markDesktopShell()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TitleBar />
      <App />
      <TipLayer />
    </StrictMode>,
  )
}

void start()
