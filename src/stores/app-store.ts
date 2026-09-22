import type { ModelMessage, Tool } from 'ai'
import { create } from 'zustand'
import AiService from '@/services/ai-service'
import type {
  LoadedModel,
  ProviderConfig,
  ProviderType,
  ReasoningEffort,
} from '@/services/ai-service'
import {
  loadAppData,
  loadSettingsData,
  saveAppData,
  saveSettingsData,
} from '@/services/app-data-service'
import getModelName from '../tools/get-model-name'
import searchWikipedia from '../tools/search-wikipedia'
import { searchWeb } from '../tools/search-web'
import { createAgentTools } from '@/services/agent-tools'
import { useToolPromptStore } from '@/stores/tool-prompt-store'
import {
  createMcpToolSession,
  inspectMcpServer,
  type McpServerConfig,
} from '@/services/mcp-service'
import type { AgentToolContext } from '@/services/agent-tool-context'
import {
  defaultSettings,
  makeChat,
  maxConcurrentLimit,
  persistedDataSchema,
  type AssistantActivity,
  type Chat,
  type ChatImage,
  type ChatMessage,
  type Settings,
} from '@/stores/app-model'

export type {
  AssistantActivity,
  Chat,
  ChatImage,
  ChatMessage,
  ChatTask,
  Settings,
  ToolTrace,
} from '@/stores/app-model'

const aiService = new AiService()
const controllers = new Map<string, AbortController>()
let generationQueue: string[] = []
let initializing = false

function formatValue(value: unknown) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'image' in value && typeof value.image === 'string')
    return '[image]'
  try {
    return (
      JSON.stringify(
        value,
        (key, item: unknown) => {
          const imageData =
            key === 'data' &&
            typeof item === 'string' &&
            item.length > 1_000 &&
            (/^data:image\//.test(item) || /^[A-Za-z0-9+/=]{128}/.test(item))
          return imageData ? '[image data]' : item
        },
        2,
      ) ?? String(value)
    )
  } catch {
    return String(value)
  }
}

function updateChat(chatId: string, update: (chat: Chat) => Chat) {
  useAppStore.setState((state) => ({
    chats: state.chats.map((chat) => (chat.id === chatId ? update(chat) : chat)),
  }))
}

function updateAssistant(
  chatId: string,
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
) {
  updateChat(chatId, (chat) => ({
    ...chat,
    messages: chat.messages.map((message) =>
      message.id === messageId ? update(message) : message,
    ),
  }))
}

function closeReasoning(activity: AssistantActivity[], now = Date.now()) {
  const next = [...activity]
  const last = next.at(-1)
  if (last?.type === 'reasoning' && last.durationMs === undefined) {
    next[next.length - 1] = { ...last, durationMs: Math.max(0, now - (last.startedAt ?? now)) }
  }
  return next
}

function createGenerationTools(chat: Chat, settings: Settings, mcpTools: Record<string, Tool>) {
  const chatId = chat.id
  const context: AgentToolContext = {
    chatId,
    folder: chat.workspaceFolder,
    images: [...chat.messages]
      .reverse()
      .flatMap((message) => [...(message.images ?? [])].reverse()),
    getChats: () => useAppStore.getState().chats,
    getTasks: (id) => useAppStore.getState().chats.find((item) => item.id === id)?.tasks ?? [],
    requestApproval: (title, description) => {
      const chatTitle =
        useAppStore.getState().chats.find((item) => item.id === chatId)?.title ?? 'Chat'
      return useToolPromptStore.getState().askApproval(`${title} · ${chatTitle}`, description)
    },
    askUser: (question) => {
      const chatTitle =
        useAppStore.getState().chats.find((item) => item.id === chatId)?.title ?? 'Chat'
      return useToolPromptStore.getState().askQuestion(`Question · ${chatTitle}`, question)
    },
    addTask: (id, text) => useAppStore.getState().addChatTask(id, text),
    completeTask: (id, taskId) => useAppStore.getState().completeChatTask(id, taskId),
    saveMemory: (memory) => {
      const current = useAppStore.getState()
      current.updateSettings({ memories: [...current.settings.memories, memory] })
    },
  }

  const enabledAgentTools = Object.fromEntries(
    Object.entries(createAgentTools(context)).filter(
      ([name]) => settings.enabledTools[name] !== false,
    ),
  )

  return {
    ...mcpTools,
    ...(settings.enabledTools.getModelName ? { getModelName: getModelName(chat.modelId) } : {}),
    ...(settings.enabledTools.searchWikipedia ? { searchWikipedia } : {}),
    ...(settings.enabledTools.searchWeb ? { searchWeb: searchWeb(settings.searxngUrl) } : {}),
    ...enabledAgentTools,
  }
}

function createSystemPrompt(settings: Settings) {
  if (!settings.memories.length) return settings.systemPrompt
  const memories = settings.memories.map((memory) => `- ${memory}`).join('\n')
  return `${settings.systemPrompt}\n\nUser-approved memories:\n${memories}`
}

function pumpGenerationQueue() {
  // Controllers represent active generations; queued chats do not consume a slot.
  while (controllers.size < useAppStore.getState().settings.maxConcurrentGenerations) {
    const chatId = generationQueue.shift()
    if (!chatId) return

    const chat = useAppStore.getState().chats.find((item) => item.id === chatId)
    if (!chat || chat.generationStatus !== 'queued') continue

    const controller = new AbortController()
    controllers.set(chatId, controller)
    void runGeneration(chatId, controller).finally(() => {
      controllers.delete(chatId)
      pumpGenerationQueue()
    })
  }
}

async function runGeneration(chatId: string, controller: AbortController) {
  const chat = useAppStore.getState().chats.find((item) => item.id === chatId)
  const assistantMessage = chat?.messages.at(-1)
  const userMessage = chat?.messages.at(-2)

  if (!chat || assistantMessage?.role !== 'assistant' || userMessage?.role !== 'user') return

  updateChat(chatId, (current) => ({ ...current, generationStatus: 'generating' }))
  const modelUserMessage: ModelMessage = {
    role: 'user',
    content: userMessage.images?.length
      ? [
          ...(userMessage.text ? [{ type: 'text' as const, text: userMessage.text }] : []),
          ...userMessage.images.map((image) => ({
            type: 'file' as const,
            mediaType: image.mediaType,
            data: image.data,
          })),
        ]
      : userMessage.text,
  }
  let responseCommitted = false
  let generationStartedAt: number | undefined
  let releaseProviderModel: () => void = () => {}
  let closeMcp = async () => {}

  try {
    const provider = useAppStore
      .getState()
      .settings.providers.find((item) => item.id === chat.providerId)
    if (!provider) throw new Error('The selected provider is no longer configured')
    const settings = useAppStore.getState().settings
    releaseProviderModel = await aiService.prepareModel(
      provider,
      chat.modelId,
      controller.signal,
      settings.unloadOtherModelsOnSwitch,
      settings.providers,
    )
    if (controller.signal.aborted) throw controller.signal.reason
    const mcpSession = await createMcpToolSession(settings.mcpServers, (id, error, tools) => {
      useAppStore.setState((state) => ({
        mcpServerStatus: {
          ...state.mcpServerStatus,
          [id]: { ...state.mcpServerStatus[id], error, tools, loading: false },
        },
      }))
      const server = settings.mcpServers.find((item) => item.id === id)
      if (server && tools) rememberMcpTools(server, tools)
    })
    closeMcp = mcpSession.close
    if (controller.signal.aborted) throw controller.signal.reason
    generationStartedAt = Date.now()
    const result = aiService.generate({
      provider,
      modelId: chat.modelId,
      reasoningEffort: chat.reasoningEffort,
      system: createSystemPrompt(settings),
      chat: [...chat.modelMessages, modelUserMessage],
      tools: createGenerationTools(chat, settings, mcpSession.tools),
      abortSignal: controller.signal,
    })

    for await (const part of result.stream) {
      switch (part.type) {
        case 'text-delta':
          updateAssistant(chatId, assistantMessage.id, (message) => ({
            ...message,
            activity: closeReasoning(message.activity),
            activeActivityId: null,
            text: message.text + part.text,
          }))
          break
        case 'reasoning-delta':
          updateAssistant(chatId, assistantMessage.id, (message) => {
            const activity = [...message.activity]
            const last = activity.at(-1)
            let activeActivityId: string
            if (last?.type === 'reasoning' && last.durationMs === undefined) {
              activity[activity.length - 1] = { ...last, text: last.text + part.text }
              activeActivityId = last.id
            } else {
              activeActivityId = crypto.randomUUID()
              activity.push({
                id: activeActivityId,
                type: 'reasoning',
                text: part.text,
                startedAt: Date.now(),
              })
            }
            return {
              ...message,
              reasoning: message.reasoning + part.text,
              activity,
              activeActivityId,
            }
          })
          break
        case 'tool-input-start':
          if (import.meta.env.DEV) console.info('[tool] input start', part.toolName)
          updateAssistant(chatId, assistantMessage.id, (message) => ({
            ...message,
            tools: [
              ...message.tools,
              { id: part.id, name: part.toolName, input: '', status: 'input' },
            ],
            activity: message.activity.some(
              (item) => item.type === 'tool' && item.toolId === part.id,
            )
              ? closeReasoning(message.activity)
              : [
                  ...closeReasoning(message.activity),
                  { id: `tool:${part.id}`, type: 'tool', toolId: part.id },
                ],
            activeActivityId: `tool:${part.id}`,
          }))
          break
        case 'tool-input-delta':
          updateAssistant(chatId, assistantMessage.id, (message) => ({
            ...message,
            tools: message.tools.map((tool) =>
              tool.id === part.id ? { ...tool, input: tool.input + part.delta } : tool,
            ),
          }))
          break
        case 'tool-call':
          if (import.meta.env.DEV) console.info('[tool] call', part.toolName)
          updateAssistant(chatId, assistantMessage.id, (message) => ({
            ...message,
            activity: message.activity.some(
              (item) => item.type === 'tool' && item.toolId === part.toolCallId,
            )
              ? closeReasoning(message.activity)
              : [
                  ...closeReasoning(message.activity),
                  { id: `tool:${part.toolCallId}`, type: 'tool', toolId: part.toolCallId },
                ],
            activeActivityId: `tool:${part.toolCallId}`,
            tools: message.tools.some((tool) => tool.id === part.toolCallId)
              ? message.tools.map((tool) =>
                  tool.id === part.toolCallId
                    ? {
                        ...tool,
                        name: part.toolName,
                        input: formatValue(part.input),
                        status: 'running',
                      }
                    : tool,
                )
              : [
                  ...message.tools,
                  {
                    id: part.toolCallId,
                    name: part.toolName,
                    input: formatValue(part.input),
                    status: 'running',
                  },
                ],
          }))
          break
        case 'tool-result':
          if (import.meta.env.DEV) console.info('[tool] complete', part.toolCallId)
          updateAssistant(chatId, assistantMessage.id, (message) => ({
            ...message,
            activeActivityId: null,
            tools: message.tools.map((tool) =>
              tool.id === part.toolCallId
                ? { ...tool, output: formatValue(part.output), status: 'complete' }
                : tool,
            ),
          }))
          break
        case 'tool-error':
          updateAssistant(chatId, assistantMessage.id, (message) => ({
            ...message,
            activeActivityId: null,
            tools: message.tools.map((tool) =>
              tool.id === part.toolCallId
                ? { ...tool, output: formatValue(part.error), status: 'error' }
                : tool,
            ),
          }))
          break
        case 'error':
          updateAssistant(chatId, assistantMessage.id, (message) => ({
            ...message,
            error: formatValue(part.error),
          }))
          break
      }
    }

    const [responseMessages, usage] = await Promise.all([result.responseMessages, result.usage])
    const durationMs = Math.max(0, Date.now() - (generationStartedAt ?? Date.now()))
    const tokensPerSecond =
      usage.outputTokens === undefined || durationMs === 0
        ? undefined
        : usage.outputTokens / (durationMs / 1000)
    updateAssistant(chatId, assistantMessage.id, (message) => ({
      ...message,
      durationMs,
      tokensPerSecond,
      outputTokens: usage.outputTokens,
    }))
    updateChat(chatId, (current) => ({
      ...current,
      modelMessages: [...current.modelMessages, modelUserMessage, ...responseMessages],
    }))
    responseCommitted = true
  } catch (error) {
    if (!controller.signal.aborted) {
      updateAssistant(chatId, assistantMessage.id, (message) => ({
        ...message,
        error: formatValue(error),
      }))
    }
  } finally {
    await closeMcp()
    releaseProviderModel()
    updateAssistant(chatId, assistantMessage.id, (message) => ({
      ...message,
      activity: closeReasoning(message.activity),
      activeActivityId: null,
      isStreaming: false,
    }))
    updateChat(chatId, (current) => {
      const steeringMessage = current.steeringMessageId
        ? current.messages.find((message) => message.id === current.steeringMessageId)
        : undefined
      const partialText =
        current.messages.find((message) => message.id === assistantMessage.id)?.text ?? ''
      const modelMessages =
        controller.signal.aborted && !responseCommitted
          ? [
              ...current.modelMessages,
              modelUserMessage,
              ...(partialText ? [{ role: 'assistant' as const, content: partialText }] : []),
            ]
          : current.modelMessages
      if (!steeringMessage || !controller.signal.aborted) {
        return { ...current, modelMessages, steeringMessageId: null, generationStatus: 'idle' }
      }
      const nextAssistant: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: '',
        reasoning: '',
        tools: [],
        activity: [],
        isStreaming: true,
      }
      // Steering aborts the current stream, retains visible text, then resumes with the new user message.
      generationQueue.push(chatId)
      return {
        ...current,
        modelMessages,
        steeringMessageId: null,
        messages: [...current.messages, nextAssistant],
        generationStatus: 'queued',
      }
    })
  }
}

type AppState = {
  settings: Settings
  chats: Chat[]
  activeChatId: string | null
  isHydrated: boolean
  modelRefreshStatus: 'idle' | 'loading' | 'success' | 'error'
  modelRefreshError: string | null
  persistenceError: string | null
  loadedModels: Record<string, LoadedModel[]>
  loadedModelErrors: Record<string, string | null>
  loadingLoadedModels: Record<string, boolean>
  mcpServerStatus: Record<string, { loading: boolean; error: string | null; tools?: string[] }>
  checkMcpServer: (id: string) => Promise<void>
  initialize: () => Promise<void>
  createChat: () => string
  selectChat: (chatId: string) => void
  renameChat: (chatId: string, title: string) => void
  deleteChat: (chatId: string) => void
  setChatDraft: (chatId: string, draft: string) => void
  setChatDraftImages: (chatId: string, images: ChatImage[]) => void
  setChatWorkspaceFolder: (chatId: string, folder: string | undefined) => void
  addChatTask: (chatId: string, task: string) => string
  completeChatTask: (chatId: string, taskId: string) => boolean
  setChatModel: (chatId: string, providerId: string, modelId: string) => void
  setChatReasoningEffort: (chatId: string, reasoningEffort: ReasoningEffort) => void
  sendMessage: (chatId: string) => void
  steerMessage: (chatId: string) => void
  stopGeneration: (chatId: string) => void
  setMaxConcurrentGenerations: (count: number) => void
  saveProviderBaseURL: (providerId: string, baseURL: string) => boolean
  updateProvider: (providerId: string, updates: Partial<ProviderConfig>) => void
  refreshModels: (providerId: string) => Promise<void>
  refreshLoadedModels: (providerId: string) => Promise<void>
  unloadLoadedModel: (providerId: string, model: LoadedModel) => Promise<void>
  setDefaultModel: (providerId: string, modelId: string) => void
  updateSettings: (
    settings: Partial<
      Pick<
        Settings,
        | 'theme'
        | 'primaryColor'
        | 'systemPrompt'
        | 'enabledTools'
        | 'defaultProviderId'
        | 'unloadOtherModelsOnSwitch'
        | 'memories'
        | 'searxngUrl'
        | 'mcpServers'
      >
    >,
  ) => void
  addProvider: (type: ProviderType, name: string) => void
  removeProvider: (providerId: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  settings: defaultSettings,
  chats: [],
  activeChatId: null,
  isHydrated: false,
  modelRefreshStatus: 'idle',
  modelRefreshError: null,
  persistenceError: null,
  loadedModels: {},
  loadedModelErrors: {},
  loadingLoadedModels: {},
  mcpServerStatus: {},

  checkMcpServer: async (id) => {
    const server = useAppStore.getState().settings.mcpServers.find((item) => item.id === id)
    if (!server) return
    set((state) => ({
      mcpServerStatus: { ...state.mcpServerStatus, [id]: { loading: true, error: null } },
    }))
    try {
      const tools = await inspectMcpServer(server)
      set((state) => ({
        mcpServerStatus: { ...state.mcpServerStatus, [id]: { loading: false, error: null, tools } },
      }))
      rememberMcpTools(server, tools)
    } catch (error) {
      set((state) => ({
        mcpServerStatus: {
          ...state.mcpServerStatus,
          [id]: { loading: false, error: formatValue(error) },
        },
      }))
    }
  },

  initialize: async () => {
    if (initializing || useAppStore.getState().isHydrated) return
    initializing = true
    let settings = defaultSettings
    let chats: Chat[] = []
    let activeChatId: string | null = null
    let persistenceError: string | null = null

    try {
      const saved = await loadAppData()
      if (saved !== null) {
        const legacySettings = persistedDataSchema.shape.settings.safeParse(
          typeof saved === 'object' && saved !== null && 'settings' in saved
            ? saved.settings
            : undefined,
        )
        if (legacySettings.success)
          settings = {
            ...defaultSettings,
            ...legacySettings.data,
            enabledTools: { ...defaultSettings.enabledTools, ...legacySettings.data.enabledTools },
          }
        const parsed = persistedDataSchema.safeParse(saved)
        if (parsed.success) {
          chats = parsed.data.chats.map((chat) => ({
            ...chat,
            modelMessages: chat.modelMessages as ModelMessage[],
            generationStatus: chat.generationStatus === 'idle' ? 'idle' : 'interrupted',
            messages: chat.messages.map((message) => ({ ...message, isStreaming: false })),
          }))
          activeChatId = parsed.data.activeChatId
        } else {
          persistenceError = 'Saved chats could not be loaded. Settings were loaded independently.'
        }
      }
    } catch (error) {
      persistenceError = `Could not load saved data: ${formatValue(error)}`
    }

    try {
      const savedSettings = loadSettingsData()
      if (savedSettings !== null) {
        const parsed = persistedDataSchema.shape.settings.parse(savedSettings)
        settings = {
          ...defaultSettings,
          ...parsed,
          enabledTools: { ...defaultSettings.enabledTools, ...parsed.enabledTools },
        }
      }
    } catch (error) {
      persistenceError = `Could not load settings: ${formatValue(error)}`
    }

    if (!chats.length) chats = [makeChat(settings)]
    if (!chats.some((chat) => chat.id === activeChatId)) activeChatId = chats[0].id

    set({ settings, chats, activeChatId, isHydrated: true, persistenceError })
    initializing = false
  },

  createChat: () => {
    const chat = makeChat(useAppStore.getState().settings)
    useAppStore.setState((state) => ({ chats: [chat, ...state.chats], activeChatId: chat.id }))
    return chat.id
  },

  selectChat: (chatId) => set({ activeChatId: chatId }),

  renameChat: (chatId, title) => {
    const nextTitle = title.trim()
    if (!nextTitle) return
    updateChat(chatId, (chat) => ({ ...chat, title: nextTitle, updatedAt: Date.now() }))
  },

  deleteChat: (chatId) => {
    generationQueue = generationQueue.filter((id) => id !== chatId)
    controllers.get(chatId)?.abort()
    useAppStore.setState((state) => {
      const chats = state.chats.filter((chat) => chat.id !== chatId)
      const nextChats = chats.length ? chats : [makeChat(state.settings)]
      return {
        chats: nextChats,
        activeChatId: state.activeChatId === chatId ? nextChats[0].id : state.activeChatId,
      }
    })
    pumpGenerationQueue()
  },

  setChatDraft: (chatId, draft) => updateChat(chatId, (chat) => ({ ...chat, draft })),

  setChatDraftImages: (chatId, images) =>
    updateChat(chatId, (chat) => ({ ...chat, draftImages: images })),

  setChatWorkspaceFolder: (chatId, workspaceFolder) =>
    updateChat(chatId, (chat) => ({ ...chat, workspaceFolder })),

  addChatTask: (chatId, text) => {
    const task = text.trim()
    if (!task) throw new Error('Task text cannot be empty.')
    const id = crypto.randomUUID()
    updateChat(chatId, (chat) => ({
      ...chat,
      tasks: [...chat.tasks, { id, text: task, complete: false }],
    }))
    return id
  },

  completeChatTask: (chatId, taskId) => {
    const chat = useAppStore.getState().chats.find((item) => item.id === chatId)
    if (!chat?.tasks.some((task) => task.id === taskId)) return false
    updateChat(chatId, (current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? { ...task, complete: true } : task)),
    }))
    return true
  },

  setChatModel: (chatId, providerId, modelId) =>
    updateChat(chatId, (chat) => ({
      ...chat,
      providerId,
      modelId,
    })),

  setChatReasoningEffort: (chatId, reasoningEffort) =>
    updateChat(chatId, (chat) => ({ ...chat, reasoningEffort })),

  sendMessage: (chatId) => {
    const { chats } = useAppStore.getState()
    const chat = chats.find((item) => item.id === chatId)
    const text = chat?.draft.trim() ?? ''
    const images = chat?.draftImages ?? []
    if (
      !chat ||
      (!text && !images.length) ||
      chat.generationStatus === 'queued' ||
      chat.generationStatus === 'generating'
    )
      return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
      images,
      reasoning: '',
      tools: [],
      activity: [],
    }
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      reasoning: '',
      tools: [],
      activity: [],
      isStreaming: true,
    }

    updateChat(chatId, (current) => ({
      ...current,
      title: current.title === 'New chat' ? (text || images[0].name).slice(0, 48) : current.title,
      draft: '',
      draftImages: [],
      messages: [...current.messages, userMessage, assistantMessage],
      generationStatus: 'queued',
      updatedAt: Date.now(),
    }))
    generationQueue.push(chatId)
    pumpGenerationQueue()
  },

  steerMessage: (chatId) => {
    const chat = useAppStore.getState().chats.find((item) => item.id === chatId)
    const text = chat?.draft.trim() ?? ''
    const images = chat?.draftImages ?? []
    if (
      !chat ||
      (!text && !images.length) ||
      chat.generationStatus !== 'generating' ||
      chat.steeringMessageId
    )
      return
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
      images,
      reasoning: '',
      tools: [],
      activity: [],
    }
    updateChat(chatId, (current) => ({
      ...current,
      draft: '',
      draftImages: [],
      steeringMessageId: message.id,
      messages: [...current.messages, message],
      updatedAt: Date.now(),
    }))
    controllers.get(chatId)?.abort('steer')
  },

  stopGeneration: (chatId) => {
    const chat = useAppStore.getState().chats.find((item) => item.id === chatId)
    if (!chat || !['queued', 'generating'].includes(chat.generationStatus)) return
    if (chat.generationStatus === 'queued') {
      generationQueue = generationQueue.filter((id) => id !== chatId)
      const assistant = chat.messages.at(-1)
      updateChat(chatId, (current) => ({
        ...current,
        messages:
          assistant?.role === 'assistant'
            ? current.messages.filter((message) => message.id !== assistant.id)
            : current.messages,
        generationStatus: 'idle',
      }))
    } else {
      updateChat(chatId, (current) => ({ ...current, steeringMessageId: null }))
      controllers.get(chatId)?.abort('stop')
    }
  },

  setMaxConcurrentGenerations: (count) => {
    if (!Number.isFinite(count)) return
    set((state) => ({
      settings: {
        ...state.settings,
        maxConcurrentGenerations: Math.min(maxConcurrentLimit, Math.max(1, Math.floor(count))),
      },
    }))
    pumpGenerationQueue()
  },

  saveProviderBaseURL: (providerId, baseURL) => {
    try {
      const parsed = new URL(baseURL.trim())
      if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('Use an HTTP or HTTPS URL')
      const providerType = useAppStore
        .getState()
        .settings.providers.find((provider) => provider.id === providerId)?.type
      const path = parsed.pathname.replace(/\/+$/, '')
      parsed.pathname =
        providerType === 'ollama'
          ? path.replace(/\/v1$/i, '')
          : path.endsWith('/v1')
            ? path
            : `${path}/v1`
      const normalizedBaseURL = parsed.toString().replace(/\/$/, '')
      set((state) => ({
        settings: {
          ...state.settings,
          providers: state.settings.providers.map((provider) =>
            provider.id === providerId ? { ...provider, baseURL: normalizedBaseURL } : provider,
          ),
        },
        modelRefreshStatus: 'idle',
        modelRefreshError: null,
      }))
      return true
    } catch (error) {
      set({ modelRefreshStatus: 'error', modelRefreshError: formatValue(error) })
      return false
    }
  },

  updateProvider: (providerId, updates) =>
    set((state) => ({
      settings: {
        ...state.settings,
        providers: state.settings.providers.map((provider) =>
          provider.id === providerId ? { ...provider, ...updates } : provider,
        ),
      },
    })),

  refreshModels: async (providerId) => {
    set({ modelRefreshStatus: 'loading', modelRefreshError: null })
    const provider = useAppStore
      .getState()
      .settings.providers.find((item) => item.id === providerId)
    if (!provider) {
      set({ modelRefreshStatus: 'error', modelRefreshError: 'Provider not found' })
      return
    }

    try {
      const models = await aiService.listModels(provider)
      if (!models.length) throw new Error(`${provider.name} did not report any models`)
      set((state) => ({
        settings: {
          ...state.settings,
          providers: state.settings.providers.map((item) =>
            item.id === providerId
              ? {
                  ...item,
                  models,
                  defaultModelId: models.includes(item.defaultModelId)
                    ? item.defaultModelId
                    : models[0],
                }
              : item,
          ),
        },
        modelRefreshStatus: 'success',
      }))
      pumpGenerationQueue()
    } catch (error) {
      set({ modelRefreshStatus: 'error', modelRefreshError: formatValue(error) })
    }
  },

  refreshLoadedModels: async (providerId) => {
    const provider = useAppStore
      .getState()
      .settings.providers.find((item) => item.id === providerId)
    if (!provider || !['lmstudio', 'ollama'].includes(provider.type)) return
    set((state) => ({
      loadingLoadedModels: { ...state.loadingLoadedModels, [providerId]: true },
      loadedModelErrors: { ...state.loadedModelErrors, [providerId]: null },
    }))
    try {
      const models = await aiService.listLoadedModels(provider)
      set((state) => ({
        loadedModels: { ...state.loadedModels, [providerId]: models },
        loadingLoadedModels: { ...state.loadingLoadedModels, [providerId]: false },
      }))
    } catch (error) {
      set((state) => ({
        loadedModelErrors: { ...state.loadedModelErrors, [providerId]: formatValue(error) },
        loadingLoadedModels: { ...state.loadingLoadedModels, [providerId]: false },
      }))
    }
  },

  unloadLoadedModel: async (providerId, model) => {
    const state = useAppStore.getState()
    const provider = state.settings.providers.find((item) => item.id === providerId)
    if (!provider) return
    const root = provider.baseURL.replace(/\/+$/, '').replace(/\/v1$/i, '')
    const busy = state.chats.some(
      (chat) =>
        chat.modelId === model.modelId &&
        ['queued', 'generating'].includes(chat.generationStatus) &&
        state.settings.providers
          .find((item) => item.id === chat.providerId)
          ?.baseURL.replace(/\/+$/, '')
          .replace(/\/v1$/i, '') === root,
    )
    if (busy) {
      set((current) => ({
        loadedModelErrors: {
          ...current.loadedModelErrors,
          [providerId]: 'This model is in use by an active chat.',
        },
      }))
      return
    }
    try {
      await aiService.unloadModel(provider, model)
      await useAppStore.getState().refreshLoadedModels(providerId)
    } catch (error) {
      set((current) => ({
        loadedModelErrors: { ...current.loadedModelErrors, [providerId]: formatValue(error) },
      }))
    }
  },

  setDefaultModel: (providerId, modelId) =>
    set((state) => ({
      settings: {
        ...state.settings,
        providers: state.settings.providers.map((provider) =>
          provider.id === providerId ? { ...provider, defaultModelId: modelId } : provider,
        ),
      },
    })),

  updateSettings: (updates) => set((state) => ({ settings: { ...state.settings, ...updates } })),

  addProvider: (type, name) => {
    const defaults: Record<ProviderType, { baseURL: string; kind: ProviderConfig['kind'] }> = {
      lmstudio: { baseURL: 'http://localhost:1234/v1', kind: 'openai-compatible' },
      ollama: { baseURL: 'http://localhost:11434', kind: 'openai-compatible' },
      openai: { baseURL: 'https://api.openai.com/v1', kind: 'openai' },
      anthropic: { baseURL: 'https://api.anthropic.com/v1', kind: 'anthropic' },
      openrouter: { baseURL: 'https://openrouter.ai/api/v1', kind: 'openai-compatible' },
      google: { baseURL: '', kind: 'google' },
    }
    const provider: ProviderConfig = {
      id: crypto.randomUUID(),
      type,
      name: name.trim(),
      ...defaults[type],
      models: [],
      defaultModelId: '',
    }
    set((state) => ({
      settings: { ...state.settings, providers: [...state.settings.providers, provider] },
    }))
  },

  removeProvider: (providerId) => {
    const removedChats = useAppStore
      .getState()
      .chats.filter((chat) => chat.providerId === providerId)
    for (const chat of removedChats) controllers.get(chat.id)?.abort()
    set((state) => {
      if (state.settings.providers.length <= 1) return state
      const providers = state.settings.providers.filter((provider) => provider.id !== providerId)
      const replacement =
        providers.find((provider) => provider.id === state.settings.defaultProviderId) ??
        providers[0]
      return {
        settings: { ...state.settings, providers, defaultProviderId: replacement.id },
        chats: state.chats.map((chat) =>
          chat.providerId === providerId
            ? {
                ...chat,
                providerId: replacement.id,
                modelId: replacement.defaultModelId || replacement.models[0] || '',
              }
            : chat,
        ),
      }
    })
  },
}))

function rememberMcpTools(server: McpServerConfig, tools: string[]) {
  useAppStore.setState((state) => {
    // Ignore discovery results from a server configuration edited while connecting.
    if (!state.settings.mcpServers.includes(server)) return state
    if (
      server.availableTools?.length === tools.length &&
      server.availableTools.every((name, index) => name === tools[index])
    ) {
      return state
    }
    return {
      settings: {
        ...state.settings,
        mcpServers: state.settings.mcpServers.map((item) =>
          item === server ? { ...item, availableTools: tools } : item,
        ),
      },
    }
  })
}

let persistTimer: ReturnType<typeof setTimeout> | undefined
let writeQueue = Promise.resolve()

function persistCurrentState() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const { settings, chats, activeChatId } = useAppStore.getState()
    const data = { version: 1, settings, chats, activeChatId }
    writeQueue = writeQueue
      .catch(() => undefined)
      .then(() => saveAppData(data))
      .then(() => {
        if (!useAppStore.getState().persistenceError?.startsWith('Could not save settings:'))
          useAppStore.setState({ persistenceError: null })
      })
      .catch((error: unknown) =>
        useAppStore.setState({ persistenceError: `Could not save data: ${formatValue(error)}` }),
      )
  }, 300)
}

useAppStore.subscribe((state, previous) => {
  if (!state.isHydrated) return
  if (state.settings !== previous.settings) {
    try {
      saveSettingsData(state.settings)
      if (state.persistenceError?.startsWith('Could not save settings:'))
        useAppStore.setState({ persistenceError: null })
    } catch (error) {
      useAppStore.setState({ persistenceError: `Could not save settings: ${formatValue(error)}` })
    }
  }
  if (
    state.settings !== previous.settings ||
    state.chats !== previous.chats ||
    state.activeChatId !== previous.activeChatId
  ) {
    persistCurrentState()
  }
})
