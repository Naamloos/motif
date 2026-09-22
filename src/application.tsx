import { useEffect } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ChatPage } from '@/pages/chat-page'
import SettingsPage from '@/pages/settings-page'
import MainLayout from '@/layouts/main-layout'
import { useAppStore } from '@/stores/app-store'

function App() {
  const initialize = useAppStore((state) => state.initialize)
  const isHydrated = useAppStore((state) => state.isHydrated)
  const theme = useAppStore((state) => state.settings.theme)
  const primaryColor = useAppStore((state) => state.settings.primaryColor)
  useEffect(() => {
    void initialize()
  }, [initialize])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      if (primaryColor) {
        const channels =
          primaryColor.match(/[\da-f]{2}/gi)?.map((part) => parseInt(part, 16) / 255) ?? []
        const luminance =
          channels.length === 3
            ? channels.reduce(
                (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
                0,
              )
            : 0.5
        document.documentElement.style.setProperty('--primary', primaryColor)
        document.documentElement.style.setProperty(
          '--primary-foreground',
          luminance > 0.55 ? '#171717' : '#ffffff',
        )
      } else {
        document.documentElement.style.removeProperty('--primary')
        document.documentElement.style.removeProperty('--primary-foreground')
      }
    }
    apply()
    if (theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme, primaryColor])

  if (!isHydrated) return null
  return (
    <MemoryRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

export default App
