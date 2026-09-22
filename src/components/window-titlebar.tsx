import { useEffect, useState } from 'react'
import { Copy, Minus, PanelLeftClose, PanelLeftOpen, Sparkles, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

function withWindow(action: (appWindow: NwWindow) => void) {
  if (typeof nw !== 'undefined') action(nw.Window.get())
}

export function WindowTitlebar({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean
  onToggleSidebar: () => void
}) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (typeof nw === 'undefined') return

    const appWindow = nw.Window.get()
    const handleMaximize = () => setIsMaximized(true)
    const handleRestore = () => setIsMaximized(false)

    appWindow.on('maximize', handleMaximize)
    appWindow.on('restore', handleRestore)

    return () => {
      appWindow.removeListener('maximize', handleMaximize)
      appWindow.removeListener('restore', handleRestore)
    }
  }, [])

  function toggleMaximize() {
    withWindow((appWindow) => {
      if (isMaximized) appWindow.restore()
      else appWindow.maximize()
    })
  }

  return (
    <header className="window-drag fixed inset-x-0 top-0 z-50 flex h-10 items-center justify-between bg-background rounded-t-xl">
      <div className="window-no-drag flex h-full">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-full rounded-none rounded-tl-xl"
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          onClick={onToggleSidebar}
        >
          {sidebarOpen ? (
            <PanelLeftClose aria-hidden="true" />
          ) : (
            <PanelLeftOpen aria-hidden="true" />
          )}
        </Button>
      </div>
      <div className="window-no-drag flex h-full">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-full rounded-none"
          aria-label="Minimize window"
          onClick={() => withWindow((appWindow) => appWindow.minimize())}
        >
          <Minus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-full rounded-none"
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          onClick={toggleMaximize}
        >
          {isMaximized ? <Copy aria-hidden="true" /> : <Square aria-hidden="true" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-full rounded-none rounded-tr-xl hover:bg-destructive hover:text-white"
          aria-label="Close window"
          onClick={() => withWindow((appWindow) => appWindow.close())}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="absolute top-0 h-full left-[50%] translate-x-[-50%] flex items-center justify-center text-sm font-medium text-muted-foreground">
        <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
        Motif
      </div>
    </header>
  )
}
