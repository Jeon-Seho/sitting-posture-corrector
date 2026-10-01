import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import '@fontsource/anton/latin-400.css'
import '@fontsource/black-han-sans/400.css'
import '@fontsource/stardos-stencil/latin-700.css'
import App from './app/ServiceApp'
import './styles.css'

async function start() {
  if (import.meta.env.DEV && import.meta.env.MODE === 'browser-smoke') {
    const { installSyntheticBrowser } = await import('./features/testing/bootstrap')
    installSyntheticBrowser()
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
