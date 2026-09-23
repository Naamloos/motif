import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { WindowTitlebar } from '@/components/window-titlebar'
import { ChatsSidebar } from '@/components/chats-sidebar'
import { ToolPromptDialog } from '@/components/tool-prompt-dialog'

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    window.matchMedia('(min-width: 768px)').matches,
  )
  const location = useLocation()
  const isSettingsPage = location.pathname === '/settings'
  const closeSidebarOnMobile = useCallback(() => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      setSidebarOpen(false)
      document.querySelector<HTMLButtonElement>('[aria-label="Close sidebar"]')?.focus()
    }
  }, [])
  const openSidebarForSearch = useCallback(() => setSidebarOpen(true), [])
  useEffect(() => {
    if (!sidebarOpen) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !window.matchMedia('(max-width: 767px)').matches) return
      setSidebarOpen(false)
      document.querySelector<HTMLButtonElement>('[aria-label="Close sidebar"]')?.focus()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [sidebarOpen])
  return (
    <div
      className={
        (isSettingsPage ? 'h-screen bg-background' : 'min-h-screen bg-background pt-10') +
        ' rounded-[0.55rem]'
      }
    >
      {(
        <WindowTitlebar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
        />
      )}
      <main
        className={[
          'relative flex min-h-0 w-full overflow-hidden px-4',
        'h-[calc(100vh-2.5rem)]',
          sidebarOpen ? 'gap-4' : '',
        ].join(' ')}
      >
        {!isSettingsPage && (
          <div
            aria-hidden={!sidebarOpen}
            inert={!sidebarOpen}
            className={[
              'flex h-full min-h-0 shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-in-out motion-reduce:transition-none',
              sidebarOpen
                ? 'w-60 opacity-100 max-md:absolute max-md:left-4 max-md:top-2 max-md:z-40 max-md:rounded-lg max-md:border max-md:bg-background max-md:shadow-xl'
                : 'w-0 opacity-0',
            ].join(' ')}
          >
            <ChatsSidebar
              onNavigate={closeSidebarOnMobile}
              onOpenSearch={openSidebarForSearch}
            />
          </div>
        )}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col py-4">
          <div key={location.pathname} className="page-transition min-h-0 flex-1">
            <Outlet />
          </div>
        </section>
      </main>
      <ToolPromptDialog />
    </div>
  )
}
