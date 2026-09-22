import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FolderOpen,
  ImagePlus,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { ChatMessageView } from '@/components/chat-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDisplayName } from '@/hooks/use-display-name'
import { useAppStore, type ChatImage } from '../stores/app-store'

interface ChatSuggestion {
  displayText: string
  prompt: string
}

const suggestions: ChatSuggestion[] = [
  {
    displayText: 'Explain a concept',
    prompt: 'Explain in simple terms the concept of ',
  },
  {
    displayText: 'Summarize an article',
    prompt: 'Summarize the following article: ',
  },
  {
    displayText: 'Generate a story',
    prompt: 'Write a short story about ',
  },
  {
    displayText: 'Provide coding help',
    prompt: 'Help me with this coding problem: ',
  },
  {
    displayText: 'Give advice',
    prompt: 'What advice would you give for ',
  },
]

const chatScrollPositions = new Map<string, number | 'bottom'>()

function readImage(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      const separator = dataUrl.indexOf(',')
      if (separator < 0) reject(new Error(`Could not read ${file.name}`))
      else
        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          mediaType: file.type,
          data: dataUrl.slice(separator + 1),
        })
    }
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

export function ChatPage() {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const stickToBottom = useRef(true)
  const [isAtTop, setIsAtTop] = useState(true)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const displayName = useDisplayName()
  const chat = useAppStore((state) => state.chats.find((item) => item.id === state.activeChatId))
  const providers = useAppStore((state) => state.settings.providers)
  const setChatDraft = useAppStore((state) => state.setChatDraft)
  const setChatDraftImages = useAppStore((state) => state.setChatDraftImages)
  const setChatWorkspaceFolder = useAppStore((state) => state.setChatWorkspaceFolder)
  const completeChatTask = useAppStore((state) => state.completeChatTask)
  const setChatModel = useAppStore((state) => state.setChatModel)
  const setChatReasoningEffort = useAppStore((state) => state.setChatReasoningEffort)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const steerMessage = useAppStore((state) => state.steerMessage)
  const stopGeneration = useAppStore((state) => state.stopGeneration)
  const draft = chat?.draft ?? ''
  const draftImages = chat?.draftImages ?? []
  const hasDraft = Boolean(draft.trim() || draftImages.length)
  const messages = chat?.messages ?? []
  const isGenerating =
    chat?.generationStatus === 'queued' || chat?.generationStatus === 'generating'
  const selectedModel = `${chat?.providerId ?? ''}\u0000${chat?.modelId ?? ''}`
  const reasoningLabel =
    chat?.reasoningEffort === 'provider-default'
      ? 'default'
      : chat?.reasoningEffort === 'none'
        ? 'off'
        : (chat?.reasoningEffort ?? 'medium')
  const edgeMask = `linear-gradient(to bottom, ${isAtTop ? 'black 0%' : 'transparent 0%, black 40px'}, ${isAtBottom ? 'black 100%' : 'black calc(100% - 40px), transparent 100%'})`

  useLayoutEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    if (!viewport || !chat?.id) return
    const saved = chatScrollPositions.get(chat.id)
    viewport.scrollTop = saved === undefined || saved === 'bottom' ? viewport.scrollHeight : saved
    stickToBottom.current = saved === undefined || saved === 'bottom'
  }, [chat?.id])

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    if (!viewport) return

    const handleScroll = () => {
      setIsAtTop(viewport.scrollTop < 8)
      const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 32
      stickToBottom.current = atBottom
      setIsAtBottom(atBottom)
      if (chat?.id) chatScrollPositions.set(chat.id, atBottom ? 'bottom' : viewport.scrollTop)
    }

    viewport.addEventListener('scroll', handleScroll)
    handleScroll()
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [chat?.id])

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    if (!viewport || !stickToBottom.current) return

    const frame = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [messages])

  const applySuggestion = (suggestion: ChatSuggestion) => {
    if (chat) setChatDraft(chat.id, suggestion.prompt)
  }

  async function addImages(files: FileList | File[] | null) {
    if (!chat || !files?.length) return
    setAttachmentError(null)
    const selectedFiles = Array.from(files)
    if (selectedFiles.some((file) => !file.type.startsWith('image/'))) {
      setAttachmentError('Choose image files only.')
      return
    }
    try {
      const images = await Promise.all(selectedFiles.map(readImage))
      const currentImages =
        useAppStore.getState().chats.find((item) => item.id === chat.id)?.draftImages ?? []
      setChatDraftImages(chat.id, [...currentImages, ...images])
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : 'Could not read the selected images.',
      )
    }
  }

  return (
    <Card className="relative m-auto flex h-full min-h-0 w-full flex-col">
      <CardContent className="relative flex min-h-0 flex-1 p-0">
        <ScrollArea
          ref={scrollAreaRef}
          className="min-h-0 flex-1"
          style={{ maskImage: edgeMask, WebkitMaskImage: edgeMask }}
        >
          {messages.length ? (
            <div className="space-y-5 p-6" aria-live="polite">
              {chat?.tasks.length ? (
                <details className="rounded-lg border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium">
                    Task list · {chat.tasks.filter((task) => task.complete).length}/
                    {chat.tasks.length}
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {chat.tasks.map((task) => (
                      <li key={task.id} className="flex items-start gap-2 text-sm">
                        <button
                          type="button"
                          aria-label={
                            task.complete ? `${task.text} completed` : `Complete ${task.text}`
                          }
                          disabled={task.complete}
                          onClick={() => completeChatTask(chat.id, task.id)}
                        >
                          <CheckCircle2
                            className={`mt-0.5 size-4 ${task.complete ? 'text-primary' : 'text-muted-foreground'}`}
                          />
                        </button>
                        <span className={task.complete ? 'text-muted-foreground line-through' : ''}>
                          {task.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {messages.map((message) => (
                <ChatMessageView key={message.id} message={message} />
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="size-6" aria-hidden="true" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold">Welcome, {displayName}</h2>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg">
                {suggestions.map((suggestion) => (
                  <Button
                    key={suggestion.displayText}
                    type="button"
                    variant="outline"
                    onClick={() => applySuggestion(suggestion)}
                  >
                    {suggestion.displayText}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </ScrollArea>
        {!isAtBottom && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="absolute bottom-2 right-6 z-10 rounded-full shadow"
            aria-label="Scroll to latest message"
            onClick={() => {
              const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
                '[data-slot="scroll-area-viewport"]',
              )
              if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
            }}
          >
            <ArrowDown />
          </Button>
        )}
      </CardContent>

      <CardFooter>
        <form
          className="flex w-full flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (chat) sendMessage(chat.id)
          }}
        >
          <div className="relative min-w-0">
            {draftImages.length > 0 && (
              <div className="absolute bottom-full left-0 mb-2 flex max-w-full gap-2 overflow-x-auto pb-1">
                {draftImages.map((image) => (
                  <div key={image.id} className="relative size-16">
                    <img
                      src={`data:${image.mediaType};base64,${image.data}`}
                      alt={image.name}
                      className="size-16 rounded-lg border object-cover"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-xs"
                      aria-label={`Remove ${image.name}`}
                      className="absolute -right-1.5 -top-1.5 rounded-full"
                      onClick={() =>
                        chat &&
                        setChatDraftImages(
                          chat.id,
                          draftImages.filter((item) => item.id !== image.id),
                        )
                      }
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Textarea
              placeholder="Type your message here..."
              className="min-h-20 w-full resize-none pb-12 pl-12 pr-28"
              value={draft}
              onChange={(e) => chat && setChatDraft(chat.id, e.target.value)}
              onPaste={(event) => {
                const images = Array.from(event.clipboardData.items)
                  .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                  .flatMap((item) => (item.getAsFile() ? [item.getAsFile()!] : []))
                if (images.length) {
                  event.preventDefault()
                  void addImages(images)
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey) {
                  event.preventDefault()
                  if (chat && hasDraft) {
                    if (chat.generationStatus === 'generating') steerMessage(chat.id)
                    else if (!isGenerating) sendMessage(chat.id)
                  }
                }
              }}
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(event) => {
                void addImages(event.currentTarget.files)
                event.currentTarget.value = ''
              }}
            />
            <input
              ref={(node) => {
                folderInputRef.current = node
                node?.setAttribute('nwdirectory', '')
              }}
              type="file"
              className="sr-only"
              onChange={(event) => {
                if (chat) setChatWorkspaceFolder(chat.id, event.currentTarget.value || undefined)
                event.currentTarget.value = ''
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute bottom-2 left-2"
              aria-label="Attach images"
              title="Attach images"
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus />
            </Button>
            <div className="absolute bottom-2 left-12 flex max-w-[calc(100%-8rem)] items-center gap-1">
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="h-6 min-w-0 max-w-full justify-start truncate px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
                    />
                  }
                >
                  {chat?.modelId || 'Select model'} - {reasoningLabel}
                </PopoverTrigger>
                <PopoverContent align="end" className="space-y-4">
                  <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                    Model
                    <select
                      aria-label="Model"
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
                      value={selectedModel}
                      onChange={(event) => {
                        const [providerId, modelId] = event.target.value.split('\u0000')
                        if (chat && providerId && modelId)
                          setChatModel(chat.id, providerId, modelId)
                      }}
                    >
                      {providers.map((provider) => (
                        <optgroup key={provider.id} label={provider.name}>
                          {provider.models.map((model) => (
                            <option key={model} value={`${provider.id}\u0000${model}`}>
                              {model}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                    Reasoning effort
                    <select
                      aria-label="Reasoning effort"
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
                      value={chat?.reasoningEffort ?? 'medium'}
                      onChange={(event) => {
                        if (chat)
                          setChatReasoningEffort(
                            chat.id,
                            event.target.value as typeof chat.reasoningEffort,
                          )
                      }}
                    >
                      <option value="provider-default">Provider default</option>
                      <option value="none">Off</option>
                      <option value="minimal">Minimal</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="xhigh">Extra high</option>
                    </select>
                  </label>
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-6 shrink-0 gap-1 px-2"
                aria-label={
                  chat?.workspaceFolder ? `Change folder: ${chat.workspaceFolder}` : 'Select folder'
                }
                title={chat?.workspaceFolder ?? 'Select folder'}
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderOpen aria-hidden="true" />
                <span className="max-w-24 truncate text-xs">
                  {chat?.workspaceFolder
                    ? chat.workspaceFolder.split(/[\\/]/).filter(Boolean).at(-1)
                    : 'Folder'}
                </span>
              </Button>
              {chat?.workspaceFolder && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0"
                  aria-label="Clear selected folder"
                  title="Clear selected folder"
                  onClick={() => setChatWorkspaceFolder(chat.id, undefined)}
                >
                  <X />
                </Button>
              )}
            </div>
            <div className="absolute bottom-2 right-2 flex gap-1">
              {isGenerating && chat?.generationStatus === 'generating' && hasDraft && (
                <Button
                  type="button"
                  size="icon-sm"
                  aria-label="Steer response"
                  title="Interrupt and steer"
                  onClick={() => chat && steerMessage(chat.id)}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
              )}
              {isGenerating ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-sm"
                  aria-label="Stop generation"
                  title="Stop"
                  onClick={() => chat && stopGeneration(chat.id)}
                >
                  <Square aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label="Send message"
                  title="Send"
                  disabled={!hasDraft}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
          {attachmentError && (
            <span role="alert" className="text-xs text-destructive">
              {attachmentError}
            </span>
          )}
          <span className="w-full text-xs text-muted-foreground text-center">
            AI makes mistakes. Please verify any information provided.
          </span>
        </form>
      </CardFooter>
    </Card>
  )
}
