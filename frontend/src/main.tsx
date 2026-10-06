import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import '@fontsource/outfit/latin-500.css'
import '@fontsource/outfit/latin-600.css'
import '@fontsource/outfit/latin-700.css'
import App from './app/ServiceApp'
import { markDesktopShell } from './features/desktop/bridge'
import { TitleBar } from './features/desktop/TitleBar'
import './styles.css'

async function start() {
  if (import.meta.env.MODE === 'face-lab') {
    const { default: FaceLabApp } = await import('./features/face-lab/FaceLabApp')
    createRoot(document.getElementById('root')!).render(<StrictMode><FaceLabApp /></StrictMode>)
    return
  }
  if (import.meta.env.MODE === 'relative-lab') {
    const { default: RelativeLabApp } = await import('./features/relative-lab/RelativeLabApp')
    createRoot(document.getElementById('root')!).render(<StrictMode><RelativeLabApp /></StrictMode>)
    return
  }
  if (import.meta.env.DEV && import.meta.env.MODE === 'browser-smoke') {
    const { installSyntheticBrowser } = await import('./features/testing/bootstrap')
    installSyntheticBrowser()
  }
  markDesktopShell()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TitleBar />
      <App />
    </StrictMode>,
  )
}

void start()
