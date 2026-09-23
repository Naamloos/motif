import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  RotateCw,
  FolderOpen,
  Gauge,
  ImagePlus,
  RefreshCw,
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
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
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
  const forceScrollToBottom = useRef(false)
  const previousScrollTop = useRef(0)
  const [isAtTop, setIsAtTop] = useState(true)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const displayName = useDisplayName()
  const chat = useAppStore((state) => state.chats.find((item) => item.id === state.activeChatId))
  const providers = useAppStore((state) => state.settings.providers)
  const globallyEnabledTools = useAppStore((state) => state.settings.enabledTools)
  const globalToolStepLimit = useAppStore((state) => state.settings.maxToolSteps)
  const contextTurnLimit = useAppStore((state) => state.settings.contextTurnLimit)
  const activeProvider = providers.find((provider) => provider.id === chat?.providerId)
  const providerUsage = useAppStore((state) =>
    chat ? state.providerUsage[chat.providerId] : undefined,
  )
  const providerUsageError = useAppStore((state) =>
    chat ? state.providerUsageErrors[chat.providerId] : null,
  )
  const loadingProviderUsage = useAppStore((state) =>
    chat ? state.loadingProviderUsage[chat.providerId] : false,
  )
  const refreshProviderUsage = useAppStore((state) => state.refreshProviderUsage)
  const setChatDraft = useAppStore((state) => state.setChatDraft)
  const setChatDraftImages = useAppStore((state) => state.setChatDraftImages)
  const setChatWorkspaceFolder = useAppStore((state) => state.setChatWorkspaceFolder)
  const completeChatTask = useAppStore((state) => state.completeChatTask)
  const setChatModel = useAppStore((state) => state.setChatModel)
  const setChatReasoningEffort = useAppStore((state) => state.setChatReasoningEffort)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const compactChatContext = useAppStore((state) => state.compactChatContext)
  const [isCompacting, setIsCompacting] = useState(false)
  const [compactionError, setCompactionError] = useState<string | null>(null)
  const steerMessage = useAppStore((state) => state.steerMessage)
  const stopGeneration = useAppStore((state) => state.stopGeneration)
  const retryGeneration = useAppStore((state) => state.retryGeneration)
  const updateChat = useAppStore((state) => state.updateChat)
  const clearChatContext = useAppStore((state) => state.clearChatContext)
  const trimChatContext = useAppStore((state) => state.trimChatContext)
  const toolNames = [
    'searchWeb',
    'searchNews',
    'searchImages',
    'searchFiles',
    'findFiles',
    'findDefinition',
    'getFileTree',
    'inspectWorkspace',
    'readFile',
    'editFile',
    'writeFile',
    'patchFile',
    'runCommand',
    'git',
    'saveMemory',
    'manageMemories',
  ]
  const draft = chat?.draft ?? ''
  const draftImages = chat?.draftImages ?? []
  const hasDraft = Boolean(draft.trim() || draftImages.length)
  const messages = chat?.messages ?? []
  const contextTurns = chat?.modelMessages.filter((message) => message.role === 'user').length ?? 0
  const estimatedTokens = Math.ceil(
    (chat?.messages.reduce(
      (total, message) => total + message.text.length + (message.images?.length ?? 0) * 1024,
      0,
    ) ?? 0) / 4,
  )
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

  async function compactContext() {
    if (!chat || isCompacting) return
    setIsCompacting(true)
    setCompactionError(null)
    try {
      await compactChatContext(chat.id)
    } catch (error) {
      setCompactionError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsCompacting(false)
    }
  }

  useLayoutEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    if (!viewport || !chat?.id) return
    const saved = chatScrollPositions.get(chat.id)
    viewport.scrollTop = saved === undefined || saved === 'bottom' ? viewport.scrollHeight : saved
    stickToBottom.current = saved === undefined || saved === 'bottom'
    previousScrollTop.current = viewport.scrollTop
  }, [chat?.id])

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    if (!viewport) return

    const handleScroll = () => {
      const scrollingDown = viewport.scrollTop > previousScrollTop.current
      setIsAtTop(viewport.scrollTop < 8)
      const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 32
      if (scrollingDown && atBottom) stickToBottom.current = true
      else if (!scrollingDown) stickToBottom.current = false
      setIsAtBottom(atBottom)
      if (chat?.id) chatScrollPositions.set(chat.id, atBottom ? 'bottom' : viewport.scrollTop)
      previousScrollTop.current = viewport.scrollTop
    }

    viewport.addEventListener('scroll', handleScroll)
    handleScroll()
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [chat?.id])

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    if (!viewport || (!stickToBottom.current && !forceScrollToBottom.current)) return
    forceScrollToBottom.current = false

    const frame = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight
      if (chat?.id) chatScrollPositions.set(chat.id, 'bottom')
      stickToBottom.current = true
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
            <div
              className="space-y-5 p-6"
              role="log"
              aria-label="Conversation"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {chat?.tasks.length ? (
                <details className="rounded-lg border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium">
                    Task list - {chat.tasks.filter((task) => task.complete).length}/
                    {chat.tasks.length}
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {chat.tasks.map((task) => (
                      <li key={task.id} className="flex items-start gap-2 text-sm">
                        <Button
                          variant="ghost"
                          size="icon-xs"
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
                        </Button>
                        <span className={task.complete ? 'text-muted-foreground line-through' : ''}>
                          {task.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {messages.map((message) => (
                <div key={message.id} className="space-y-1">
                  <ChatMessageView message={message} />
                  {message.role === 'assistant' &&
                    message === messages.at(-1) &&
                    (message.error || chat?.generationStatus === 'interrupted') &&
                    !isGenerating && (
                      message.tools.length ? (
                        <p className="text-xs text-muted-foreground" role="status">
                          Retry is disabled because this run used tools; repeating it could repeat their actions.
                        </p>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => chat && retryGeneration(chat.id)}
                        >
                          <RotateCw /> Retry response
                        </Button>
                      )
                    )}
                </div>
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
            if (chat) {
              stickToBottom.current = true
              forceScrollToBottom.current = true
              chatScrollPositions.set(chat.id, 'bottom')
              sendMessage(chat.id)
            }
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
                    Chat instructions
                    <Textarea
                      aria-label="Chat instructions"
                      rows={3}
                      value={chat?.instructions ?? ''}
                      onChange={(event) =>
                        chat && updateChat(chat.id, { instructions: event.target.value })
                      }
                      placeholder="Additional instructions for this chat"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={chat?.useMemories ?? true}
                      onCheckedChange={(checked) =>
                        chat && updateChat(chat.id, { useMemories: checked === true })
                      }
                    />
                    Include saved memories
                  </label>
                  <details>
                    <summary className="cursor-pointer text-xs font-medium">
                      Tools for this chat
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {toolNames.map((name) => (
                        <label key={name} className="flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={chat?.enabledTools[name] ?? true}
                            disabled={globallyEnabledTools[name] === false}
                            onCheckedChange={(checked) =>
                              chat &&
                              updateChat(chat.id, {
                                enabledTools: {
                                  ...chat.enabledTools,
                                  [name]: checked === true,
                                },
                              })
                            }
                          />
                          {name}
                        </label>
                      ))}
                    </div>
                  </details>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="chat-tool-step-limit"
                      className="block text-xs font-medium text-muted-foreground"
                    >
                      Tool steps for this chat
                    </label>
                    <Input
                      id="chat-tool-step-limit"
                      aria-label="Tool steps for this chat"
                      type="number"
                      min={1}
                      max={100}
                      value={chat?.maxToolSteps ?? globalToolStepLimit}
                      onChange={(event) => {
                        if (!chat) return
                        updateChat(chat.id, {
                          maxToolSteps: Math.max(
                            1,
                            Math.min(
                              100,
                              Number(event.target.value) || globalToolStepLimit,
                            ),
                          ),
                        })
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={chat?.maxToolSteps === undefined}
                      onClick={() => chat && updateChat(chat.id, { maxToolSteps: undefined })}
                    >
                      Use global default ({globalToolStepLimit})
                    </Button>
                  </div>
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-xs text-muted-foreground">
                      Transcript estimate: about {estimatedTokens.toLocaleString()} tokens -{' '}
                      {Math.min(contextTurns, contextTurnLimit)} of {contextTurnLimit} recent turns sent
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Estimate uses visible text and approximate image cost. The transcript stays
                      intact when context is cleared.
                    </p>
                    <div className="flex min-w-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        className="min-w-0"
                        onClick={() => chat && trimChatContext(chat.id)}
                      >
                        Trim to limit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        className="min-w-0"
                        disabled={!chat || contextTurns <= contextTurnLimit || isCompacting || isGenerating}
                        onClick={compactContext}
                      >
                        {isCompacting ? 'Compacting...' : 'Compact chat'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="min-w-0"
                        onClick={() => chat && clearChatContext(chat.id)}
                      >
                        Clear model context
                      </Button>
                    </div>
                    {compactionError && <p className="text-xs text-destructive">{compactionError}</p>}
                  </div>
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
            <Popover
              onOpenChange={(open) => {
                if (
                  open &&
                  chat &&
                  (activeProvider?.type === 'codex-cli' ||
                    (activeProvider?.type === 'openrouter' && activeProvider.apiKey))
                ) {
                  void refreshProviderUsage(activeProvider.id)
                }
              }}
            >
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute bottom-2 right-12"
                    aria-label="Show provider usage"
                    title="Provider usage"
                  />
                }
              >
                <Gauge aria-hidden="true" />
              </PopoverTrigger>
              <PopoverContent align="end" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {activeProvider?.name ?? 'Provider'} usage
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {providerUsage?.type === 'codex-cli' && providerUsage.limits.planType
                        ? `${providerUsage.limits.planType} plan`
                        : activeProvider?.type === 'openrouter'
                          ? 'Account credits'
                          : activeProvider?.type === 'codex-cli'
                            ? 'Account rate limits'
                            : 'Usage data is unavailable for this provider.'}
                    </p>
                  </div>
                  {(activeProvider?.type === 'codex-cli' ||
                    activeProvider?.type === 'openrouter') && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Refresh provider usage"
                      title="Refresh usage"
                      disabled={
                        loadingProviderUsage ||
                        (activeProvider.type === 'openrouter' && !activeProvider.apiKey)
                      }
                      onClick={() => void refreshProviderUsage(activeProvider.id)}
                    >
                      <RefreshCw className={loadingProviderUsage ? 'animate-spin' : ''} />
                    </Button>
                  )}
                </div>
                {providerUsageError && (
                  <p role="alert" className="text-xs text-destructive">
                    {providerUsageError}
                  </p>
                )}
                {providerUsage?.type === 'codex-cli' && (
                  <div className="space-y-3">
                    {[providerUsage.limits.primary, providerUsage.limits.secondary].map(
                      (window, index) =>
                        window ? (
                          <div key={index} className="space-y-1.5">
                            <div className="flex justify-between gap-4 text-xs">
                              <span>{index === 0 ? 'Current window' : 'Longer window'}</span>
                              <span>{Math.max(0, 100 - window.usedPercent)}% remaining</span>
                            </div>
                            <Progress value={100 - window.usedPercent} />
                            {window.resetsAt && (
                              <p className="text-xs text-muted-foreground">
                                Resets {new Date(window.resetsAt * 1000).toLocaleString()}
                              </p>
                            )}
                          </div>
                        ) : null,
                    )}
                    {!providerUsage.limits.primary && !providerUsage.limits.secondary && (
                      <p className="text-xs text-muted-foreground">No rate limits were reported.</p>
                    )}
                  </div>
                )}
                {providerUsage?.type === 'openrouter' && (
                  <div className="space-y-1.5">
                    <p className="text-sm">
                      ${(providerUsage.totalCredits - providerUsage.totalUsage).toFixed(2)}{' '}
                      remaining
                    </p>
                    <Progress
                      value={
                        providerUsage.totalCredits > 0
                          ? ((providerUsage.totalCredits - providerUsage.totalUsage) /
                              providerUsage.totalCredits) *
                            100
                          : 0
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      ${providerUsage.totalUsage.toFixed(2)} used of $
                      {providerUsage.totalCredits.toFixed(2)}
                    </p>
                  </div>
                )}
                {activeProvider?.type === 'openrouter' && !activeProvider.apiKey && (
                  <p className="text-xs text-muted-foreground">
                    Set a management key in provider settings to view credits.
                  </p>
                )}
              </PopoverContent>
            </Popover>
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
