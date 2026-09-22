import { Link, NavLink, useNavigate } from 'react-router'
import { useState } from 'react'
import { MessageSquarePlus, Pencil, Settings2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/stores/app-store'

export function ChatsSidebar() {
  const navigate = useNavigate()
  const chats = useAppStore((state) => state.chats)
  const activeChatId = useAppStore((state) => state.activeChatId)
  const createChat = useAppStore((state) => state.createChat)
  const selectChat = useAppStore((state) => state.selectChat)
  const deleteChat = useAppStore((state) => state.deleteChat)
  const renameChat = useAppStore((state) => state.renameChat)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const renamingChat = chats.find((chat) => chat.id === renamingId)

  return (
    <aside className="flex h-full min-h-0 w-60 shrink-0 flex-col gap-2 py-4">
      <Button
        className="w-full justify-start"
        onClick={() => {
          createChat()
          navigate('/')
        }}
      >
        <MessageSquarePlus /> New chat
      </Button>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`group flex items-center rounded-md ${chat.id === activeChatId ? 'bg-muted' : 'hover:bg-muted'}`}
          >
            <Link
              to="/"
              onClick={() => selectChat(chat.id)}
              className="min-w-0 flex-1 truncate px-3 py-2 text-sm"
            >
              {chat.title}
              {chat.generationStatus === 'generating' || chat.generationStatus === 'queued'
                ? ' · …'
                : chat.generationStatus === 'interrupted'
                  ? ' · interrupted'
                  : ''}
            </Link>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Rename ${chat.title}`}
              onClick={() => {
                setRenamingId(chat.id)
                setTitle(chat.title)
              }}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Delete ${chat.title}`}
              onClick={() => deleteChat(chat.id)}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      <NavLink
        to="/settings"
        className={({ isActive }) =>
          `flex items-center gap-2 rounded-md px-3 py-2 text-sm ${isActive ? 'bg-muted' : 'hover:bg-muted'}`
        }
      >
        <Settings2 className="size-4" /> Settings
      </NavLink>
      <Dialog
        open={renamingChat !== undefined}
        onOpenChange={(open) => {
          if (!open) setRenamingId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>Choose a name for this chat.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (renamingChat) renameChat(renamingChat.id, title)
              setRenamingId(null)
            }}
            className="space-y-4"
          >
            <Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
            <DialogFooter>
              <Button type="submit">Save name</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
