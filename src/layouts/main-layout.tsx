import { useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { WindowTitlebar } from '@/components/window-titlebar'
import { ChatsSidebar } from '@/components/chats-sidebar'
import { ToolPromptDialog } from '@/components/tool-prompt-dialog'

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const location = useLocation()
  const isSettingsPage = location.pathname === '/settings'
  return (
    <div
      className={
        (isSettingsPage ? 'h-screen bg-background' : 'min-h-screen bg-background pt-10') +
        ' rounded-3xl'
      }
    >
      {!isSettingsPage && (
        <WindowTitlebar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
        />
      )}
      <main
        className={`flex ${isSettingsPage ? 'h-screen' : 'h-[calc(100vh-2.5rem)]'} min-h-0 w-full overflow-hidden px-4` + (sidebarOpen ? ' gap-4' : '')}
      >
        {!isSettingsPage && (
          <div
            aria-hidden={!sidebarOpen}
            inert={!sidebarOpen}
            className={`flex h-full min-h-0 shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-in-out motion-reduce:transition-none ${sidebarOpen ? 'w-60 opacity-100' : 'w-0 opacity-0'}`}
          >
            <ChatsSidebar />
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
