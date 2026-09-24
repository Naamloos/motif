import os from 'node:os'
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
import { searchWikipedia } from '@/tools/search-wikipedia'
import { searchImages, searchNews, searchWeb } from '@/tools/search-web'
import { createAgentTools } from '@/services/agent-tools'
import { useToolPromptStore } from '@/stores/tool-prompt-store'
import {
  createMcpToolSession,
  inspectMcpServer,
  type McpServerConfig,
} from '@/services/mcp-service'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { readCodexUsageLimits, type CodexUsageLimits } from '@/services/codex-usage-service'
import { getCurrentDisplayName } from '@/hooks/use-display-name'
import {
  defaultSettings,
  makeChat,
  maxConcurrentLimit,
  persistedDataSchema,
  type AssistantActivity,
  type Chat,
  type ChatImage,
  type ChatMessage,
  type ToolTrace,
  type Settings,
  type RunSettingsSnapshot,
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
const pendingRunSnapshots = new Map<string, { chat: Chat; settings: Settings }>()
let generationQueue: string[] = []
let initializing = false

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'name' in value && 'message' in value) {
    const error = value as {
      name: unknown
      message: unknown
      cause?: unknown
      code?: unknown
      data?: unknown
    }
    const cause = error.cause ? `\nCaused by: ${formatValue(error.cause)}` : ''
    const code = error.code !== undefined ? `\nCode: ${String(error.code)}` : ''
    const data = error.data !== undefined ? `\nDetails: ${formatValue(error.data)}` : ''
    return `${String(error.name)}: ${String(error.message) || 'Unknown error'}${code}${data}${cause}`
  }
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

function makeRunSnapshot(chat: Chat, settings: Settings): RunSettingsSnapshot {
  const provider = settings.providers.find((item) => item.id === chat.providerId)
  const enabledTools = Object.keys(settings.enabledTools).filter(
    (name) => settings.enabledTools[name] !== false && chat.enabledTools[name] !== false,
  )
  for (const server of settings.mcpServers) {
    if (!server.enabled) continue
    for (const name of server.availableTools ?? []) {
      if (!server.disabledTools?.includes(name)) enabledTools.push(`${server.name}.${name}`)
    }
  }
  return {
    provider: provider?.name ?? 'Unknown provider',
    model: chat.modelId,
    reasoningEffort: chat.reasoningEffort,
    maxToolSteps: chat.maxToolSteps ?? settings.maxToolSteps,
    enabledTools,
    contextTurns: settings.contextTurnLimit,
    systemPrompt: createSystemPrompt(settings, chat),
    memories: chat.useMemories ? [...settings.memories] : [],
    workspaceFolder: chat.workspaceFolder,
    approvalForFileChanges: settings.requireApprovalForFileChanges,
    approvalForMcpTools: settings.requireApprovalForMcpTools,
    approvalForCommands: settings.requireApprovalForCommands,
    approvalForBrowser: settings.requireApprovalForBrowser,
  }
}

function queueRunSnapshot(chatId: string) {
  const state = useAppStore.getState()
  const chat = state.chats.find((item) => item.id === chatId)
  if (chat) {
    pendingRunSnapshots.set(chatId, {
      // Settings and chat records use immutable Zustand updates, so shallow copies freeze the
      // selected records without duplicating potentially large image and transcript payloads.
      chat: {
        ...chat,
        messages: [...chat.messages],
        modelMessages: [...chat.modelMessages],
        tasks: [...chat.tasks],
      },
      settings: {
        ...state.settings,
        providers: [...state.settings.providers],
        enabledTools: { ...state.settings.enabledTools },
        mcpServers: [...state.settings.mcpServers],
        memories: [...state.settings.memories],
      },
    })
  }
}

function limitModelContext(messages: ModelMessage[], turnLimit: number) {
  const userTurns: number[] = []
  for (let index = messages.length - 1; index >= 0 && userTurns.length < turnLimit; index -= 1) {
    if (messages[index].role === 'user') userTurns.push(index)
  }
  return messages.slice(userTurns.at(-1) ?? 0)
}

async function compactMessages(
  chat: Chat,
  messages: ModelMessage[],
  settings: Settings,
  turnLimit = settings.contextTurnLimit,
  abortSignal?: AbortSignal,
) {
  const userTurns: number[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') userTurns.push(index)
  }
  if (userTurns.length <= turnLimit) return messages
  const keepFrom = userTurns[turnLimit - 1]
  if (keepFrom <= 0) return messages
  const provider = settings.providers.find((item) => item.id === chat.providerId)
  if (!provider) throw new Error('The selected provider is no longer configured')
  const generation = aiService.generate({
    provider,
    modelId: chat.modelId,
    cwd: chat.workspaceFolder,
    reasoningEffort: 'none',
    maxToolSteps: 1,
    system:
      'Summarize the conversation so far for future use. Preserve the user’s goals, decisions, preferences, important facts, and unresolved work. Be concise. Return only the summary.',
    chat: messages.slice(0, keepFrom),
    tools: {},
    abortSignal,
  })
  let summary = ''
  try {
    for await (const part of generation.result.textStream) summary += part
  } finally {
    await generation.close()
  }
  return summary.trim()
    ? [
        { role: 'system' as const, content: `Earlier conversation summary:\n${summary.trim()}` },
        ...messages.slice(keepFrom),
      ]
    : messages
}

function closeReasoning(activity: AssistantActivity[], now = Date.now()) {
  const next = [...activity]
  const last = next.at(-1)
  if (last?.type === 'reasoning' && last.durationMs === undefined) {
    next[next.length - 1] = { ...last, durationMs: Math.max(0, now - (last.startedAt ?? now)) }
  }
  return next
}

function createGenerationTools(
  chat: Chat,
  settings: Settings,
  mcpTools: Record<string, Tool>,
  abortSignal: AbortSignal,
) {
  const chatId = chat.id
  const context: AgentToolContext = {
    chatId,
    abortSignal,
    folder: chat.workspaceFolder,
    images: [...chat.messages]
      .reverse()
      .flatMap((message) => [...(message.images ?? [])].reverse()),
    getChats: () => useAppStore.getState().chats,
    getTasks: (id) => useAppStore.getState().chats.find((item) => item.id === id)?.tasks ?? [],
    requestApproval: (title, description) => {
      const chatTitle =
        useAppStore.getState().chats.find((item) => item.id === chatId)?.title ?? 'Chat'
      return useToolPromptStore
        .getState()
        .askApproval(`${title} - ${chatTitle}`, description)
        .then((approved) => {
          const current = useAppStore.getState()
          current.updateSettings({
            toolAudit: [
              ...current.settings.toolAudit.slice(-499),
              {
                id: crypto.randomUUID(),
                at: Date.now(),
                chatTitle,
                action: title,
                details:
                  description.length <= 4_000 ? description : `${description.slice(0, 4_000)}...`,
                approved,
              },
            ],
          })
          return approved
        })
    },
    askUser: (question) => {
      const chatTitle =
        useAppStore.getState().chats.find((item) => item.id === chatId)?.title ?? 'Chat'
      return useToolPromptStore.getState().askQuestion(`Question - ${chatTitle}`, question)
    },
    addTask: (id, text) => useAppStore.getState().addChatTask(id, text),
    completeTask: (id, taskId) => useAppStore.getState().completeChatTask(id, taskId),
    saveMemory: (memory) => {
      const current = useAppStore.getState()
      if (!current.settings.memories.includes(memory))
        current.updateSettings({ memories: [...current.settings.memories, memory] })
    },
    listMemories: () => useAppStore.getState().settings.memories,
    removeMemory: (memory) => {
      const current = useAppStore.getState()
      if (!current.settings.memories.includes(memory)) return false
      current.updateSettings({
        memories: current.settings.memories.filter((item) => item !== memory),
      })
      return true
    },
    updateMemory: (memory, replacement) => {
      const current = useAppStore.getState()
      if (!current.settings.memories.includes(memory)) return false
      current.updateSettings({
        memories: current.settings.memories.map((item) => (item === memory ? replacement : item)),
      })
      return true
    },
    requireApprovalForFileChanges: settings.requireApprovalForFileChanges,
    requireApprovalForMcpTools: settings.requireApprovalForMcpTools,
    requireApprovalForCommands: settings.requireApprovalForCommands,
    requireApprovalForBrowser: settings.requireApprovalForBrowser,
  }

  const enabledAgentTools = Object.fromEntries(
    Object.entries(createAgentTools(context)).filter(
      ([name]) => settings.enabledTools[name] !== false && chat.enabledTools[name] !== false,
    ),
  )

  const guardedMcpTools = Object.fromEntries(
    Object.entries(mcpTools).map(([name, mcpTool]) => [
      name,
      {
        ...mcpTool,
        execute: async (input: unknown, options: unknown) => {
          if (
            context.requireApprovalForMcpTools &&
            !(await context.requestApproval(`Use MCP tool: ${name}`, formatValue(input)))
          ) {
            return 'The user denied this MCP tool request.'
          }
          if (!mcpTool.execute) throw new Error(`MCP tool ${name} cannot be executed.`)
          return mcpTool.execute(input as never, options as never)
        },
      } as Tool,
    ]),
  )

  return {
    ...guardedMcpTools,
    ...(settings.enabledTools.getModelName !== false && chat.enabledTools.getModelName !== false
      ? { getModelName: getModelName(chat.modelId) }
      : {}),
    ...(settings.enabledTools.searchWikipedia !== false &&
    chat.enabledTools.searchWikipedia !== false
      ? { searchWikipedia: searchWikipedia(abortSignal) }
      : {}),
    ...(settings.enabledTools.searchWeb !== false && chat.enabledTools.searchWeb !== false
      ? { searchWeb: searchWeb(settings.searxngUrl, abortSignal) }
      : {}),
    ...(settings.enabledTools.searchNews !== false && chat.enabledTools.searchNews !== false
      ? { searchNews: searchNews(settings.searxngUrl, abortSignal) }
      : {}),
    ...(settings.enabledTools.searchImages !== false && chat.enabledTools.searchImages !== false
      ? { searchImages: searchImages(settings.searxngUrl, abortSignal) }
      : {}),
    ...enabledAgentTools,
  }
}

function findMcpUiResource(value: unknown): ToolTrace['app'] | undefined {
  if (!value || typeof value !== 'object' || !('content' in value) || !Array.isArray(value.content))
    return
  for (const item of value.content) {
    if (!item || typeof item !== 'object' || !('type' in item)) continue
    const resource = item.type === 'resource' && 'resource' in item ? item.resource : item
    if (
      !resource ||
      typeof resource !== 'object' ||
      !('uri' in resource) ||
      typeof resource.uri !== 'string' ||
      !('mimeType' in resource) ||
      typeof resource.mimeType !== 'string'
    )
      continue
    const html =
      'text' in resource && typeof resource.text === 'string'
        ? resource.text
        : 'blob' in resource && typeof resource.blob === 'string'
          ? atob(resource.blob)
          : undefined
    const externalUrl =
      resource.mimeType === 'text/uri-list'
        ? html?.split(/\r?\n/).find((line: string) => /^https?:\/\//.test(line.trim()))
        : undefined
    if (
      html !== undefined &&
      (resource.uri.startsWith('ui://') ||
        resource.mimeType.includes('mcp-ui') ||
        resource.mimeType === 'text/html;profile=mcp-app')
    ) {
      return { uri: resource.uri, mimeType: resource.mimeType, html: externalUrl ?? html }
    }
  }
  return
}

function createSystemPrompt(settings: Settings, chat: Chat) {
  const displayName = getCurrentDisplayName()
  const instructions = [settings.systemPrompt, chat.instructions].filter(Boolean).join('\n\n')
  const now = new Date()
  const runtimeContext = [
    'Runtime context (use when relevant; do not repeat unless useful):',
    `Current user: ${displayName}`,
    `Current local date and time: ${new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(now)}`,
    `Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `Operating system: ${os.type()} ${os.release()} (${os.arch()})`,
    `Hostname: ${os.hostname()}`,
    `Conversation: ${chat.title}`,
    `Workspace folder: ${chat.workspaceFolder || 'not selected'}`,
  ]
  const enabledTools = Object.keys(settings.enabledTools).filter(
    (name) => settings.enabledTools[name] !== false && chat.enabledTools[name] !== false,
  )
  for (const server of settings.mcpServers) {
    if (!server.enabled) continue
    for (const name of server.availableTools ?? []) {
      if (!server.disabledTools?.includes(name)) enabledTools.push(`${server.name}.${name}`)
    }
  }
  runtimeContext.push(`Enabled tools: ${enabledTools.length ? enabledTools.join(', ') : 'none'}`)

  const sections = [instructions, runtimeContext.join('\n')]
  if (chat.useMemories && settings.memories.length) {
    sections.push(
      `User-approved memories:\n${settings.memories.map((memory) => `- ${memory}`).join('\n')}`,
    )
  }
  return sections.filter(Boolean).join('\n\n')
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
    const snapshot = pendingRunSnapshots.get(chatId)
    pendingRunSnapshots.delete(chatId)
    void runGeneration(chatId, controller, snapshot).finally(() => {
      controllers.delete(chatId)
      pumpGenerationQueue()
    })
  }
}

async function runGeneration(
  chatId: string,
  controller: AbortController,
  snapshot?: { chat: Chat; settings: Settings },
) {
  const chat = snapshot?.chat ?? useAppStore.getState().chats.find((item) => item.id === chatId)
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
  let closeProvider = async () => {}

  try {
    const settings = snapshot?.settings ?? useAppStore.getState().settings
    const provider = settings.providers.find((item) => item.id === chat.providerId)
    if (!provider) throw new Error('The selected provider is no longer configured')
    if (chat.title === 'New chat' && userMessage.text.trim()) {
      const titleGeneration = aiService.generate({
        provider,
        modelId: chat.modelId,
        cwd: chat.workspaceFolder,
        reasoningEffort: 'none',
        maxToolSteps: 1,
        system:
          'Generate a concise title for the conversation from the user’s first message. Return only the title, with no quotation marks or explanation. Keep it under 8 words.',
        chat: [{ role: 'user', content: userMessage.text }],
        tools: {},
        abortSignal: controller.signal,
      })
      let title = ''
      try {
        for await (const part of titleGeneration.result.textStream) title += part
      } finally {
        await titleGeneration.close()
      }
      const generatedTitle = title
        .trim()
        .replace(/^['"“”]+|['"“”]+$/g, '')
        .slice(0, 64)
      if (generatedTitle) {
        updateChat(chatId, (current) => ({
          ...current,
          title: current.title === 'New chat' ? generatedTitle : current.title,
        }))
      }
    }
    if (controller.signal.aborted) throw controller.signal.reason
    const compactedContext = await compactMessages(
      chat,
      chat.modelMessages,
      settings,
      Math.max(1, settings.contextTurnLimit - 1),
      controller.signal,
    )
    if (compactedContext !== chat.modelMessages) {
      updateChat(chatId, (current) => ({ ...current, modelMessages: compactedContext }))
    }
    if (controller.signal.aborted) throw controller.signal.reason
    releaseProviderModel = await aiService.prepareModel(
      provider,
      chat.modelId,
      controller.signal,
      settings.unloadOtherModelsOnSwitch,
      settings.providers,
    )
    if (controller.signal.aborted) throw controller.signal.reason
    const mcpSession = await createMcpToolSession(
      settings.mcpServers,
      (id, error, tools) => {
        useAppStore.setState((state) => ({
          mcpServerStatus: {
            ...state.mcpServerStatus,
            [id]: { ...state.mcpServerStatus[id], error, tools, loading: false },
          },
        }))
        const server = settings.mcpServers.find((item) => item.id === id)
        if (server && tools) rememberMcpTools(server, tools)
      },
      chat.workspaceFolder,
    )
    closeMcp = mcpSession.close
    if (controller.signal.aborted) throw controller.signal.reason
    generationStartedAt = Date.now()
    const generation = aiService.generate({
      provider,
      modelId: chat.modelId,
      cwd: chat.workspaceFolder,
      reasoningEffort: chat.reasoningEffort,
      maxToolSteps: chat.maxToolSteps ?? settings.maxToolSteps,
      system: createSystemPrompt(settings, chat),
      chat: [...compactedContext, modelUserMessage],
      tools: createGenerationTools(chat, settings, mcpSession.tools, controller.signal),
      abortSignal: controller.signal,
    })
    const result = generation.result
    closeProvider = generation.close

    for await (const part of result.stream) {
      switch (part.type) {
        case 'text-delta':
          updateAssistant(chatId, assistantMessage.id, (message) => {
            const activity = closeReasoning(message.activity)
            const last = activity.at(-1)
            if (last?.type === 'text') {
              activity[activity.length - 1] = { ...last, text: last.text + part.text }
            } else {
              activity.push({ id: crypto.randomUUID(), type: 'text', text: part.text })
            }
            return {
              ...message,
              activity,
              activeActivityId: null,
              text: message.text + part.text,
            }
          })
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
        case 'tool-result': {
          if (import.meta.env.DEV) console.info('[tool] complete', part.toolCallId)
          const returnedApp = findMcpUiResource(part.output)
          const linkedApp = mcpSession.apps[part.toolName]
          const app = returnedApp
            ? {
                ...returnedApp,
                serverId: mcpSession.serversByTool[part.toolName],
                toolName: linkedApp?.toolName,
              }
            : linkedApp
          updateAssistant(chatId, assistantMessage.id, (message) => ({
            ...message,
            activeActivityId: null,
            tools: message.tools.map((tool) =>
              tool.id === part.toolCallId
                ? {
                    ...tool,
                    output: formatValue(part.output),
                    app: tool.app ?? app,
                    status: 'complete',
                  }
                : tool,
            ),
          }))
          break
        }
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
    await Promise.allSettled([closeProvider(), closeMcp()])
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
        runSnapshot: makeRunSnapshot(current, useAppStore.getState().settings),
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
    if (
      useAppStore.getState().chats.find((item) => item.id === chatId)?.generationStatus === 'queued'
    ) {
      queueRunSnapshot(chatId)
    }
  }
}

type AppState = {
  settings: Settings
  chats: Chat[]
  activeChatId: string | null
  isHydrated: boolean
  modelRefreshStatus: 'idle' | 'loading' | 'success' | 'error'
  modelRefreshError: string | null
  providerUsage: Record<string, ProviderUsage | undefined>
  providerUsageErrors: Record<string, string | null | undefined>
  loadingProviderUsage: Record<string, boolean | undefined>
  persistenceError: string | null
  loadedModels: Record<string, LoadedModel[]>
  loadedModelErrors: Record<string, string | null>
  loadingLoadedModels: Record<string, boolean>
  mcpServerStatus: Record<string, { loading: boolean; error: string | null; tools?: string[] }>
  checkMcpServer: (id: string) => Promise<void>
  initialize: () => Promise<void>
  createChat: () => string
  duplicateChat: (chatId: string) => string | null
  selectChat: (chatId: string) => void
  renameChat: (chatId: string, title: string) => void
  updateChat: (
    chatId: string,
    updates: Partial<
      Pick<
        Chat,
        'instructions' | 'enabledTools' | 'useMemories' | 'pinned' | 'archived' | 'maxToolSteps'
      >
    >,
  ) => void
  deleteChat: (chatId: string) => void
  clearChatContext: (chatId: string) => void
  trimChatContext: (chatId: string) => void
  compactChatContext: (chatId: string) => Promise<void>
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
  retryGeneration: (chatId: string) => void
  setMaxConcurrentGenerations: (count: number) => void
  saveProviderBaseURL: (providerId: string, baseURL: string) => boolean
  updateProvider: (providerId: string, updates: Partial<ProviderConfig>) => void
  refreshModels: (providerId: string) => Promise<void>
  refreshProviderUsage: (providerId: string) => Promise<void>
  refreshLoadedModels: (providerId: string) => Promise<void>
  unloadLoadedModel: (providerId: string, model: LoadedModel) => Promise<void>
  setDefaultModel: (providerId: string, modelId: string) => void
  updateSettings: (
    settings: Partial<
      Pick<
        Settings,
        | 'theme'
        | 'maxToolSteps'
        | 'contextTurnLimit'
        | 'requireApprovalForFileChanges'
        | 'requireApprovalForMcpTools'
        | 'requireApprovalForCommands'
        | 'requireApprovalForBrowser'
        | 'primaryColor'
        | 'systemPrompt'
        | 'enabledTools'
        | 'defaultProviderId'
        | 'unloadOtherModelsOnSwitch'
        | 'memories'
        | 'toolAudit'
        | 'searxngUrl'
        | 'mcpServers'
      >
    >,
  ) => void
  addProvider: (type: ProviderType, name: string) => void
  removeProvider: (providerId: string) => void
}

type ProviderUsage =
  | { type: 'codex-cli'; limits: CodexUsageLimits }
  | { type: 'openrouter'; totalCredits: number; totalUsage: number }

export const useAppStore = create<AppState>((set) => ({
  settings: defaultSettings,
  chats: [],
  activeChatId: null,
  isHydrated: false,
  modelRefreshStatus: 'idle',
  modelRefreshError: null,
  providerUsage: {},
  providerUsageErrors: {},
  loadingProviderUsage: {},
  persistenceError: null,
  loadedModels: {},
  loadedModelErrors: {},
  loadingLoadedModels: {},
  mcpServerStatus: {},

  checkMcpServer: async (id) => {
    const state = useAppStore.getState()
    const server = state.settings.mcpServers.find((item) => item.id === id)
    if (!server) return
    const cwd = state.chats.find((chat) => chat.id === state.activeChatId)?.workspaceFolder
    set((state) => ({
      mcpServerStatus: { ...state.mcpServerStatus, [id]: { loading: true, error: null } },
    }))
    try {
      const tools = await inspectMcpServer(server, cwd)
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

  duplicateChat: (chatId) => {
    const source = useAppStore.getState().chats.find((chat) => chat.id === chatId)
    if (!source) return null

    const messageIds = new Map(
      source.messages.map((message) => [message.id, crypto.randomUUID()] as const),
    )
    const toolIds = new Map(
      source.messages.flatMap((message) =>
        message.tools.map((tool) => [tool.id, crypto.randomUUID()] as const),
      ),
    )
    const duplicate: Chat = {
      ...source,
      id: crypto.randomUUID(),
      title: `${source.title} copy`,
      draft: '',
      draftImages: [],
      tasks: source.tasks.map((task) => ({ ...task, id: crypto.randomUUID() })),
      messages: source.messages.map((message) => ({
        ...message,
        id: messageIds.get(message.id)!,
        images: message.images?.map((image) => ({ ...image, id: crypto.randomUUID() })),
        tools: message.tools.map((tool) => ({ ...tool, id: toolIds.get(tool.id)! })),
        activity: message.activity.map((activity) => {
          if (activity.type === 'tool') {
            return {
              ...activity,
              id: crypto.randomUUID(),
              toolId: toolIds.get(activity.toolId) ?? activity.toolId,
            }
          }
          return { ...activity, id: crypto.randomUUID() }
        }),
        isStreaming: false,
        activeActivityId: null,
      })),
      generationStatus: 'idle',
      steeringMessageId: null,
      archived: false,
      updatedAt: Date.now(),
    }
    useAppStore.setState((state) => ({
      chats: [duplicate, ...state.chats],
      activeChatId: duplicate.id,
    }))
    return duplicate.id
  },

  selectChat: (chatId) => set({ activeChatId: chatId }),

  renameChat: (chatId, title) => {
    const nextTitle = title.trim()
    if (!nextTitle) return
    updateChat(chatId, (chat) => ({ ...chat, title: nextTitle, updatedAt: Date.now() }))
  },
  updateChat: (chatId, updates) => updateChat(chatId, (chat) => ({ ...chat, ...updates })),

  deleteChat: (chatId) => {
    generationQueue = generationQueue.filter((id) => id !== chatId)
    pendingRunSnapshots.delete(chatId)
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

  clearChatContext: (chatId) => updateChat(chatId, (chat) => ({ ...chat, modelMessages: [] })),

  trimChatContext: (chatId) => {
    const limit = useAppStore.getState().settings.contextTurnLimit
    updateChat(chatId, (chat) => ({
      ...chat,
      modelMessages: limitModelContext(chat.modelMessages, limit),
    }))
  },

  compactChatContext: async (chatId) => {
    const state = useAppStore.getState()
    const chat = state.chats.find((item) => item.id === chatId)
    if (!chat || chat.generationStatus !== 'idle') return
    const settings = state.settings
    const messages = chat.modelMessages
    const userTurns = messages.filter((message) => message.role === 'user').length
    if (userTurns <= settings.contextTurnLimit) return
    const controller = new AbortController()
    const compacted = await compactMessages(
      chat,
      messages,
      settings,
      settings.contextTurnLimit,
      controller.signal,
    )
    updateChat(chatId, (current) =>
      current.modelMessages === messages ? { ...current, modelMessages: compacted } : current,
    )
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
      runSnapshot: makeRunSnapshot(chat, useAppStore.getState().settings),
    }

    updateChat(chatId, (current) => ({
      ...current,
      title: current.title,
      draft: '',
      draftImages: [],
      messages: [...current.messages, userMessage, assistantMessage],
      generationStatus: 'queued',
      updatedAt: Date.now(),
    }))
    queueRunSnapshot(chatId)
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
      pendingRunSnapshots.delete(chatId)
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

  retryGeneration: (chatId) => {
    const chat = useAppStore.getState().chats.find((item) => item.id === chatId)
    if (!chat || !['idle', 'interrupted'].includes(chat.generationStatus)) return
    const lastAssistant = chat.messages.at(-1)
    const lastUser = chat.messages.at(-2)
    if (lastAssistant?.role !== 'assistant' || lastUser?.role !== 'user') return
    // Replaying tool calls can repeat file writes or other external actions.
    if (lastAssistant.tools.length) return
    // Keep the user message and replace the failed partial response before retrying.
    const assistant: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      reasoning: '',
      tools: [],
      activity: [],
      isStreaming: true,
      runSnapshot: makeRunSnapshot(chat, useAppStore.getState().settings),
    }
    updateChat(chatId, (current) => ({
      ...current,
      messages: [...current.messages.slice(0, -1), assistant],
      generationStatus: 'queued',
    }))
    queueRunSnapshot(chatId)
    generationQueue.push(chatId)
    pumpGenerationQueue()
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

  refreshProviderUsage: async (providerId) => {
    const provider = useAppStore
      .getState()
      .settings.providers.find((item) => item.id === providerId)
    if (!provider || !['codex-cli', 'openrouter'].includes(provider.type)) return
    set((state) => ({
      loadingProviderUsage: { ...state.loadingProviderUsage, [providerId]: true },
      providerUsageErrors: { ...state.providerUsageErrors, [providerId]: null },
    }))
    try {
      const usage =
        provider.type === 'codex-cli'
          ? { type: 'codex-cli' as const, limits: await readCodexUsageLimits() }
          : await readOpenRouterCredits(provider.apiKey)
      set((state) => ({
        providerUsage: { ...state.providerUsage, [providerId]: usage },
        loadingProviderUsage: { ...state.loadingProviderUsage, [providerId]: false },
      }))
    } catch (error) {
      set((state) => ({
        providerUsageErrors: { ...state.providerUsageErrors, [providerId]: formatValue(error) },
        loadingProviderUsage: { ...state.loadingProviderUsage, [providerId]: false },
      }))
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
      'codex-cli': { baseURL: '', kind: 'openai' },
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

async function readOpenRouterCredits(apiKey?: string): Promise<ProviderUsage> {
  if (!apiKey) throw new Error('Add an OpenRouter management key to view credits.')
  const response = await fetch('https://openrouter.ai/api/v1/credits', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) throw new Error(`OpenRouter credits returned ${response.status}`)
  const result: unknown = await response.json()
  if (
    !result ||
    typeof result !== 'object' ||
    !('data' in result) ||
    !result.data ||
    typeof result.data !== 'object' ||
    !('total_credits' in result.data) ||
    typeof result.data.total_credits !== 'number' ||
    !('total_usage' in result.data) ||
    typeof result.data.total_usage !== 'number'
  ) {
    throw new Error('OpenRouter returned invalid credit data')
  }
  return {
    type: 'openrouter',
    totalCredits: result.data.total_credits,
    totalUsage: result.data.total_usage,
  }
}

let persistTimer: ReturnType<typeof setTimeout> | undefined
let writeQueue = Promise.resolve()

function persistCurrentState() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = undefined
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
  }, 750)
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
