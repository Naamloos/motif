import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/application'

const darkMode = window.matchMedia('(prefers-color-scheme: dark)')

function applyTheme() {
  document.documentElement.classList.toggle('dark', darkMode.matches)
}

applyTheme()

darkMode.addEventListener('change', applyTheme)

if (import.meta.env.DEV) {
  window.addEventListener('beforeunload', () => console.info('[motif] window unloading'))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
