import { Link, NavLink, useNavigate } from 'react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  CopyPlus,
  Download,
  Ellipsis,
  ListChecks,
  MessageSquarePlus,
  Pencil,
  Pin,
  Settings2,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/stores/app-store'
import type { Chat, ChatMessage } from '@/stores/app-model'

function searchableMessage(message: ChatMessage) {
  const toolText = message.tools
    .map((tool) => `${tool.name} ${tool.input} ${tool.output ?? ''}`)
    .join(' ')
  return `${message.text} ${toolText}`
}

function exportChats(items: Chat[]) {
  const markdown = items
    .map((chat) => {
      const transcript = chat.messages
        .map((message) => {
          const heading = message.role === 'user' ? 'You' : 'Assistant'
          const attachments =
            message.images
              ?.map(
                (image) => `\n\n![${image.name}](data:${image.mediaType};base64,${image.data})`,
              )
              .join('') ?? ''
          const tools = message.tools
            .map(
              (tool) =>
                `\n\n**${tool.name}**\n\nInput: ${tool.input}\n\nOutput: ${tool.output ?? tool.status}`,
            )
            .join('')
          return `## ${heading}\n\n${message.text}${attachments}${tools}`
        })
        .join('\n\n')
      return `# ${chat.title}\n\n${transcript}`
    })
    .join('\n\n---\n\n')
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
  const anchor = document.createElement('a')
  anchor.href = url
  const name = items.length === 1 ? items[0].title : 'conversations'
  anchor.download = `${name.replace(/[<>:"/\\|?*]/g, '-')}.md`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function ChatsSidebar({
  onNavigate,
  onOpenSearch,
}: {
  onNavigate?: () => void
  onOpenSearch?: () => void
}) {
  const navigate = useNavigate()
  const chats = useAppStore((state) => state.chats)
  const activeChatId = useAppStore((state) => state.activeChatId)
  const createChat = useAppStore((state) => state.createChat)
  const duplicateChat = useAppStore((state) => state.duplicateChat)
  const selectChat = useAppStore((state) => state.selectChat)
  const deleteChat = useAppStore((state) => state.deleteChat)
  const renameChat = useAppStore((state) => state.renameChat)
  const updateChat = useAppStore((state) => state.updateChat)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [deleteChatId, setDeleteChatId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const shortcutState = useRef({ chats, activeChatId })
  useEffect(() => {
    shortcutState.current = { chats, activeChatId }
  }, [chats, activeChatId])
  const selectedChats = chats.filter((chat) => selectedIds.includes(chat.id))
  const visibleChats = useMemo(
    () =>
      chats
        .filter(
          (chat) =>
            !chat.archived &&
            `${chat.title} ${chat.messages.map((message) => searchableMessage(message)).join(' ')}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
    [chats, query],
  )
  const archivedChats = chats.filter(
    (chat) =>
      chat.archived &&
      `${chat.title} ${chat.messages.map((message) => searchableMessage(message)).join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const renamingChat = chats.find((chat) => chat.id === renamingId)
  const deletingChat = chats.find((chat) => chat.id === deleteChatId)

  function archiveChat(chatId: string) {
    updateChat(chatId, { archived: true })
    if (chatId !== activeChatId) return

    const nextChat = visibleChats.find((chat) => chat.id !== chatId)
    if (nextChat) selectChat(nextChat.id)
    else createChat()
    navigate('/')
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenSearch?.()
        window.requestAnimationFrame(() => searchRef.current?.focus())
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        createChat()
        navigate('/')
        onNavigate?.()
      } else if (
        event.shiftKey &&
        event.key.toLowerCase() === 'e' &&
        shortcutState.current.activeChatId
      ) {
        event.preventDefault()
        exportChats(
          shortcutState.current.chats.filter(
            (chat) => chat.id === shortcutState.current.activeChatId,
          ),
        )
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [createChat, navigate, onNavigate, onOpenSearch])

  return (
    <aside className="flex h-full min-h-0 w-60 shrink-0 flex-col gap-2 py-4">
      <Button
        className="w-full justify-start"
        title="New chat (Ctrl+N)"
        onClick={() => {
          createChat()
          navigate('/')
          onNavigate?.()
        }}
      >
        <MessageSquarePlus /> New chat
      </Button>
      <Input
        aria-label="Search conversations"
        aria-keyshortcuts="Control+K Meta+K"
        ref={searchRef}
        placeholder="Search conversations (Ctrl+K)"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setSelectMode((value) => !value)
            setSelectedIds([])
          }}
        >
          <ListChecks /> {selectMode ? 'Done selecting' : 'Select chats'}
        </Button>
        {selectedChats.length > 0 && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Export selected conversations"
              onClick={() => exportChats(selectedChats)}
            >
              <Download />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Archive selected conversations"
              onClick={() => {
                const selected = new Set(selectedIds)
                selectedChats.forEach((chat) => updateChat(chat.id, { archived: true }))
                setSelectedIds([])
                if (activeChatId && selected.has(activeChatId)) {
                  const nextChat = visibleChats.find((chat) => !selected.has(chat.id))
                  if (nextChat) selectChat(nextChat.id)
                  else createChat()
                  navigate('/')
                }
              }}
            >
              <Archive />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Delete selected conversations"
              onClick={() => setConfirmBulkDelete(true)}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {visibleChats.map((chat) => (
          <div
            key={chat.id}
            className={`group flex items-center rounded-md ${chat.id === activeChatId ? 'bg-muted' : 'hover:bg-muted'}`}
          >
            {selectMode && (
              <Checkbox
                aria-label={`Select ${chat.title}`}
                checked={selectedIds.includes(chat.id)}
                onCheckedChange={(checked) =>
                  setSelectedIds((current) =>
                    checked ? [...current, chat.id] : current.filter((id) => id !== chat.id),
                  )
                }
              />
            )}
            <Link
              to="/"
              onClick={() => {
                selectChat(chat.id)
                onNavigate?.()
              }}
              className="min-w-0 flex-1 truncate px-3 py-2 text-sm"
            >
              {chat.title}
              {chat.generationStatus === 'generating' || chat.generationStatus === 'queued'
                ? ' - ...'
                : chat.generationStatus === 'interrupted'
                  ? ' - interrupted'
                  : ''}
            </Link>
            {!selectMode && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Actions for ${chat.title}`}
                    />
                  }
                >
                  <Ellipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      duplicateChat(chat.id)
                      navigate('/')
                      onNavigate?.()
                    }}
                  >
                    <CopyPlus /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportChats([chat])}>
                    <Download /> Export
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => updateChat(chat.id, { pinned: !chat.pinned })}
                  >
                    <Pin /> {chat.pinned ? 'Unpin' : 'Pin'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => archiveChat(chat.id)}>
                    <Archive /> Archive
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setRenamingId(chat.id)
                      setTitle(chat.title)
                    }}
                  >
                    <Pencil /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteChatId(chat.id)}
                  >
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
        {archivedChats.length > 0 && (
          <details className="pt-2" open={Boolean(query.trim())}>
            <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
              Archived
            </summary>
            {archivedChats.map((chat) => (
              <div key={chat.id} className="flex items-center gap-1 rounded-md px-2 py-1">
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 justify-start truncate text-left text-sm"
                  onClick={() => {
                    updateChat(chat.id, { archived: false })
                    selectChat(chat.id)
                    navigate('/')
                    onNavigate?.()
                  }}
                >
                  {chat.title}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Unarchive ${chat.title}`}
                  onClick={() => updateChat(chat.id, { archived: false })}
                >
                  <Archive />
                </Button>
              </div>
            ))}
          </details>
        )}
      </div>
      <NavLink
        to="/settings"
        onClick={() => onNavigate?.()}
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
      <Dialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete selected conversations?</DialogTitle>
            <DialogDescription>
              This permanently deletes {selectedChats.length} conversation
              {selectedChats.length === 1 ? '' : 's'} and stops any active runs.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmBulkDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                selectedChats.forEach((chat) => deleteChat(chat.id))
                setSelectedIds([])
                setSelectMode(false)
                setConfirmBulkDelete(false)
              }}
            >
              Delete conversations
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deletingChat !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleteChatId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deletingChat?.title}”?</DialogTitle>
            <DialogDescription>This permanently deletes the conversation and stops its run.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteChatId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deletingChat) deleteChat(deletingChat.id)
                setDeleteChatId(null)
              }}
            >
              Delete conversation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
