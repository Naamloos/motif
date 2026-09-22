import type { ModelMessage } from 'ai'
import { z } from 'zod'
import type { ProviderConfig, ReasoningEffort } from '@/services/ai-service'
import type { McpServerConfig } from '@/services/mcp-service'

export type ToolTrace = {
  id: string
  name: string
  input: string
  output?: string
  status: 'input' | 'running' | 'complete' | 'error'
}

export type AssistantActivity =
  | { id: string; type: 'reasoning'; text: string; startedAt?: number; durationMs?: number }
  | { id: string; type: 'tool'; toolId: string }

export type ChatImage = { id: string; name: string; mediaType: string; data: string }
export type ChatTask = { id: string; text: string; complete: boolean }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  images?: ChatImage[]
  reasoning: string
  tools: ToolTrace[]
  activity: AssistantActivity[]
  error?: string
  durationMs?: number
  tokensPerSecond?: number
  outputTokens?: number
  isStreaming?: boolean
  activeActivityId?: string | null
}

export type Chat = {
  id: string
  title: string
  draft: string
  draftImages: ChatImage[]
  workspaceFolder?: string
  tasks: ChatTask[]
  providerId: string
  modelId: string
  reasoningEffort: ReasoningEffort
  messages: ChatMessage[]
  modelMessages: ModelMessage[]
  generationStatus: 'idle' | 'queued' | 'generating' | 'interrupted'
  steeringMessageId?: string | null
  updatedAt: number
}

export type Settings = {
  maxConcurrentGenerations: number
  unloadOtherModelsOnSwitch: boolean
  defaultProviderId: string
  providers: ProviderConfig[]
  theme: 'system' | 'light' | 'dark'
  primaryColor: string
  systemPrompt: string
  enabledTools: Record<string, boolean>
  searxngUrl: string
  mcpServers: McpServerConfig[]
  memories: string[]
}

export const maxConcurrentLimit = 8

export const defaultSettings: Settings = {
  maxConcurrentGenerations: 1,
  unloadOtherModelsOnSwitch: true,
  defaultProviderId: 'lmstudio',
  theme: 'system',
  primaryColor: '',
  systemPrompt: 'You are motif, a helpful AI assistant. You were built by Naamloos, and your github link is: https://github.com/Naamloos/motif',
  searxngUrl: '',
  mcpServers: [],
  enabledTools: {
    getModelName: true,
    searchWikipedia: true,
    searchWeb: true,
    fetchWebpage: true,
    listFiles: true,
    searchFiles: true,
    readFile: true,
    readDocument: true,
    writeFile: true,
    patchFile: true,
    runCommand: true,
    askUser: true,
    manageTasks: true,
    searchChats: true,
    saveMemory: true,
    openInBrowser: true,
    ocrImage: true,
    browserNavigate: true,
    browserInspect: true,
    browserClick: true,
    browserFill: true,
    browserScreenshot: true,
  },
  memories: [],
  providers: [
    {
      id: 'lmstudio',
      type: 'lmstudio',
      name: 'LM Studio',
      kind: 'openai-compatible',
      baseURL: 'http://localhost:1234/v1',
      models: ['prism-ml/bonsai-27b'],
      defaultModelId: 'prism-ml/bonsai-27b',
    },
  ],
}

const chatImageSchema = z.object({
  id: z.string(),
  name: z.string(),
  mediaType: z.string(),
  data: z.string(),
})

const toolTraceSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.string(),
  output: z.string().optional(),
  status: z.enum(['input', 'running', 'complete', 'error']),
})

const assistantActivitySchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('reasoning'),
    text: z.string(),
    startedAt: z.number().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({ id: z.string(), type: z.literal('tool'), toolId: z.string() }),
])

const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  images: z.array(chatImageSchema).optional(),
  reasoning: z.string(),
  tools: z.array(toolTraceSchema),
  activity: z.array(assistantActivitySchema).default([]),
  error: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  tokensPerSecond: z.number().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  isStreaming: z.boolean().optional(),
  activeActivityId: z.string().nullable().optional(),
})

export const persistedDataSchema = z.object({
  version: z.literal(1),
  settings: z.object({
    maxConcurrentGenerations: z.number().int().min(1).max(maxConcurrentLimit),
    unloadOtherModelsOnSwitch: z.boolean().default(true),
    defaultProviderId: z.string(),
    theme: z.enum(['system', 'light', 'dark']).default('system'),
    primaryColor: z.string().default(''),
    systemPrompt: z.string().default('You are a helpful assistant.'),
    searxngUrl: z.string().default(''),
    mcpServers: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          transport: z.enum(['stdio', 'http', 'sse']),
          enabled: z.boolean().default(true),
          command: z.string().optional(),
          args: z.array(z.string()).optional(),
          env: z.record(z.string(), z.string()).optional(),
          url: z.string().optional(),
          headers: z.record(z.string(), z.string()).optional(),
          auth: z.enum(['none', 'oauth']).optional(),
          oauthClientId: z.string().optional(),
          oauthClientSecret: z.string().optional(),
          oauthCallbackPort: z.number().int().min(1024).max(65535).optional(),
          disabledTools: z.array(z.string()).optional(),
          availableTools: z.array(z.string()).optional(),
        }),
      )
      .default([]),
    enabledTools: z.record(z.string(), z.boolean()).default({
      getModelName: true,
      searchWikipedia: true,
    }),
    memories: z.array(z.string()).default([]),
    providers: z.array(
      z.object({
        id: z.string(),
        type: z
          .enum(['lmstudio', 'ollama', 'openai', 'anthropic', 'openrouter', 'google'])
          .default('lmstudio'),
        name: z.string(),
        kind: z.enum(['openai-compatible', 'openai', 'anthropic', 'google']),
        baseURL: z.string(),
        models: z.array(z.string()),
        defaultModelId: z.string(),
        apiKey: z.string().optional(),
        organization: z.string().optional(),
        project: z.string().optional(),
        siteURL: z.string().optional(),
        appName: z.string().optional(),
        contextLength: z.number().int().positive().optional(),
      }),
    ),
  }),
  chats: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      draft: z.string(),
      draftImages: z.array(chatImageSchema).default([]),
      workspaceFolder: z.string().optional(),
      tasks: z
        .array(
          z.object({
            id: z.string(),
            text: z.string(),
            complete: z.boolean(),
          }),
        )
        .default([]),
      providerId: z.string(),
      modelId: z.string(),
      reasoningEffort: z
        .enum(['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
        .default('medium'),
      messages: z.array(chatMessageSchema),
      modelMessages: z.array(z.unknown()),
      generationStatus: z.enum(['idle', 'queued', 'generating', 'interrupted']),
      steeringMessageId: z.string().nullable().optional(),
      updatedAt: z.number(),
    }),
  ),
  activeChatId: z.string().nullable(),
})

export function makeChat(settings: Settings): Chat {
  const provider =
    settings.providers.find((item) => item.id === settings.defaultProviderId) ??
    settings.providers[0] ??
    defaultSettings.providers[0]

  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    draft: '',
    draftImages: [],
    tasks: [],
    providerId: provider.id,
    modelId: provider.defaultModelId || provider.models[0] || 'prism-ml/bonsai-27b',
    reasoningEffort: 'medium',
    messages: [],
    modelMessages: [],
    generationStatus: 'idle',
    updatedAt: Date.now(),
  }
}
