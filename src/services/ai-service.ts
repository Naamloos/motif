import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOllama } from 'ai-sdk-ollama'
import {
  isStepCount,
  streamText,
  type Instructions,
  type LanguageModel,
  type ModelMessage,
  type Tool,
} from 'ai'

export type ProviderKind = 'openai-compatible' | 'openai' | 'anthropic' | 'google'
export type ProviderType = 'lmstudio' | 'ollama' | 'openai' | 'anthropic' | 'openrouter' | 'google'
export type ReasoningEffort =
  'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type ProviderConfig = {
  id: string
  type: ProviderType
  name: string
  kind: ProviderKind
  baseURL: string
  models: string[]
  defaultModelId: string
  apiKey?: string
  organization?: string
  project?: string
  siteURL?: string
  appName?: string
  contextLength?: number
}

export type LoadedModel = {
  modelId: string
  instanceId?: string
  contextLength?: number
  size?: number
}

export interface AiServiceOptions {
  system: Instructions
  chat: ModelMessage[]
  tools: { [key: string]: Tool }
  provider: ProviderConfig
  modelId: string
  reasoningEffort: ReasoningEffort
  abortSignal?: AbortSignal
}

type ModelContextLease = {
  modelId?: string
  contextLength?: number
  // -1 means a model is being unloaded/loaded; positive values count active generations.
  active: number
  waiters: Array<() => void>
}

export default class AiService {
  private modelLeases = new Map<string, ModelContextLease>()

  generate(options: AiServiceOptions) {
    const model = this.getModel(options.provider, options.modelId)

    return streamText({
      model,
      prompt: options.chat,
      tools: options.tools,
      instructions: options.system,
      reasoning: options.reasoningEffort,
      stopWhen: isStepCount(15),
      abortSignal: options.abortSignal,
    })
  }

  async prepareModel(
    provider: ProviderConfig,
    modelId: string,
    abortSignal?: AbortSignal,
    unloadOtherModels = false,
    providers: ProviderConfig[] = [provider],
  ) {
    const localProvider = provider.type === 'lmstudio' || provider.type === 'ollama'
    const configureLMStudioContext = provider.type === 'lmstudio' && Boolean(provider.contextLength)
    const localProviders = new Map<string, ProviderConfig>()
    for (const item of [provider, ...providers]) {
      if (item.type !== 'lmstudio' && item.type !== 'ollama') continue
      const root = providerRoot(item)
      const key = `${item.type}\0${root}`
      if (!localProviders.has(key)) localProviders.set(key, item)
    }
    const exclusive = unloadOtherModels && localProviders.size > 0
    if (!exclusive && !configureLMStudioContext) return () => undefined
    const endpoint = providerRoot(provider)
    const key = exclusive ? 'all-local-models' : `${provider.type}\0${endpoint}\0${modelId}`
    let lease = this.modelLeases.get(key)
    if (!lease) {
      lease = { active: 0, waiters: [] }
      this.modelLeases.set(key, lease)
    }

    // Share identical requests; serialize unload/load operations across local providers.
    while (true) {
      if (abortSignal?.aborted) throw abortSignal.reason
      if (lease.active === 0) {
        lease.active = -1
        break
      }
      if (
        lease.active > 0 &&
        lease.modelId === modelId &&
        lease.contextLength === provider.contextLength
      ) {
        lease.active++
        return () => this.releaseModelLease(lease!)
      }
      await this.waitForModelLease(lease, abortSignal)
    }

    try {
      if (exclusive) {
        for (const [key, item] of localProviders) {
          const isSelectedProvider = localProvider && key === `${provider.type}\0${endpoint}`
          if (item.type === 'lmstudio')
            await this.ensureLMStudioContext(item, isSelectedProvider ? modelId : undefined, true)
          else await this.ensureOllamaExclusiveModel(item, isSelectedProvider ? modelId : undefined)
        }
        if (!localProvider) {
          lease.active = 0
          this.wakeModelWaiters(lease)
          return () => undefined
        }
      } else if (provider.type === 'lmstudio') {
        await this.ensureLMStudioContext(provider, modelId, false)
      }
      lease.modelId = modelId
      lease.contextLength = provider.contextLength
      lease.active = 1
      return () => this.releaseModelLease(lease!)
    } catch (error) {
      lease.active = 0
      this.wakeModelWaiters(lease)
      throw error
    }
  }

  async listModels(provider: ProviderConfig): Promise<string[]> {
    const baseURL = providerRoot(provider)
    const headers = this.headers(provider)
    if (provider.type === 'lmstudio') {
      const nativeResponse = await fetch(`${baseURL}/api/v1/models`, { headers })
      if (nativeResponse.ok) {
        const result: unknown = await nativeResponse.json()
        if (
          !result ||
          typeof result !== 'object' ||
          !('models' in result) ||
          !Array.isArray(result.models)
        ) {
          throw new Error(`${provider.name} returned an invalid model list`)
        }
        return result.models.flatMap((item: unknown) =>
          item &&
          typeof item === 'object' &&
          'type' in item &&
          item.type === 'llm' &&
          'key' in item &&
          typeof item.key === 'string'
            ? [item.key]
            : [],
        )
      }
      if (nativeResponse.status !== 404)
        throw new Error(`${provider.name} returned ${nativeResponse.status}`)
    }

    if (provider.type === 'ollama') {
      const nativeResponse = await fetch(`${baseURL}/api/tags`, { headers })
      if (nativeResponse.ok) {
        const result: unknown = await nativeResponse.json()
        if (
          !result ||
          typeof result !== 'object' ||
          !('models' in result) ||
          !Array.isArray(result.models)
        ) {
          throw new Error(`${provider.name} returned an invalid model list`)
        }
        return result.models.flatMap((item: unknown) =>
          item && typeof item === 'object' && 'name' in item && typeof item.name === 'string'
            ? [item.name]
            : [],
        )
      }
      if (nativeResponse.status !== 404)
        throw new Error(`${provider.name} returned ${nativeResponse.status}`)
    }

    const endpoint =
      provider.type === 'anthropic'
        ? `${baseURL}/v1/models`
        : `${provider.baseURL.replace(/\/+$/, '')}/models`
    if (provider.type === 'anthropic')
      return this.listAnthropicModels(endpoint, headers, provider.name)
    const response = await fetch(endpoint, { headers })
    if (!response.ok) throw new Error(`${provider.name} returned ${response.status}`)

    const result: unknown = await response.json()
    if (
      !result ||
      typeof result !== 'object' ||
      !('data' in result) ||
      !Array.isArray(result.data)
    ) {
      throw new Error(`${provider.name} returned an invalid model list`)
    }

    return result.data.flatMap((item: unknown) =>
      item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'
        ? [item.id]
        : [],
    )
  }

  async listLoadedModels(provider: ProviderConfig): Promise<LoadedModel[]> {
    if (provider.type !== 'lmstudio' && provider.type !== 'ollama') {
      throw new Error(`${provider.name} does not support loaded-model listing`)
    }
    const root = providerRoot(provider)
    const response = await fetch(
      `${root}${provider.type === 'lmstudio' ? '/api/v1/models' : '/api/ps'}`,
      { headers: this.headers(provider) },
    )
    if (!response.ok) throw new Error(`${provider.name} returned ${response.status}`)
    const result: unknown = await response.json()
    if (
      !result ||
      typeof result !== 'object' ||
      !('models' in result) ||
      !Array.isArray(result.models)
    ) {
      throw new Error(`${provider.name} returned an invalid loaded-model list`)
    }
    const models = result.models as unknown[]
    if (provider.type === 'lmstudio') {
      return models.flatMap((value): LoadedModel[] => {
        if (
          !isRecord(value) ||
          value.type !== 'llm' ||
          typeof value.key !== 'string' ||
          !Array.isArray(value.loaded_instances)
        )
          return []
        const modelId = value.key
        return value.loaded_instances.flatMap((instance): LoadedModel[] => {
          if (!isRecord(instance) || typeof instance.id !== 'string') return []
          const config = isRecord(instance.config) ? instance.config : {}
          return [
            {
              modelId,
              instanceId: instance.id,
              contextLength: finiteNumber(config.context_length),
            },
          ]
        })
      })
    }
    return models.flatMap((value): LoadedModel[] => {
      if (!isRecord(value)) return []
      const modelId =
        typeof value.model === 'string'
          ? value.model
          : typeof value.name === 'string'
            ? value.name
            : undefined
      return typeof modelId === 'string'
        ? [
            {
              modelId,
              contextLength: finiteNumber(value.context_length),
              size: finiteNumber(value.size),
            },
          ]
        : []
    })
  }

  async unloadModel(provider: ProviderConfig, model: LoadedModel) {
    const root = providerRoot(provider)
    const lmStudio = provider.type === 'lmstudio'
    const response = await fetch(`${root}${lmStudio ? '/api/v1/models/unload' : '/api/generate'}`, {
      method: 'POST',
      headers: { ...this.headers(provider), 'Content-Type': 'application/json' },
      body: JSON.stringify(
        lmStudio
          ? { instance_id: model.instanceId }
          : { model: model.modelId, prompt: '', keep_alive: 0 },
      ),
    })
    if (!response.ok)
      throw new Error(`${provider.name} could not unload ${model.modelId} (${response.status})`)
  }

  private getModel(provider: ProviderConfig, modelId: string): LanguageModel {
    if (provider.type === 'openai') {
      if (!provider.apiKey) throw new Error(`Add an API key for ${provider.name} in Settings`)
      return createOpenAI({
        apiKey: provider.apiKey,
        baseURL: provider.baseURL,
        organization: provider.organization || undefined,
        project: provider.project || undefined,
      }).chat(modelId)
    }
    if (provider.type === 'anthropic') {
      if (!provider.apiKey) throw new Error(`Add an API key for ${provider.name} in Settings`)
      return createAnthropic({ apiKey: provider.apiKey, baseURL: provider.baseURL }).languageModel(
        modelId,
      )
    }
    if (provider.type === 'ollama') {
      return createOllama({
        baseURL: providerRoot(provider),
        apiKey: provider.apiKey,
      }).chat(
        modelId,
        provider.contextLength ? { options: { num_ctx: provider.contextLength } } : undefined,
      )
    }
    if (provider.type === 'openrouter' && !provider.apiKey) {
      throw new Error(`Add an API key for ${provider.name} in Settings`)
    }
    if (!['lmstudio', 'openrouter'].includes(provider.type)) {
      throw new Error(`${provider.name} is not configured yet`)
    }
    return createOpenAICompatible({
      name: provider.type,
      baseURL: provider.baseURL,
      apiKey: provider.apiKey,
      includeUsage: true,
      headers: provider.type === 'openrouter' ? this.openRouterHeaders(provider) : undefined,
    }).languageModel(modelId)
  }

  private headers(provider: ProviderConfig): Record<string, string> {
    if (provider.type === 'anthropic') {
      return {
        ...(provider.apiKey ? { 'x-api-key': provider.apiKey } : {}),
        'anthropic-version': '2023-06-01',
      }
    }
    return {
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      ...(provider.type === 'openai' && provider.organization
        ? { 'OpenAI-Organization': provider.organization }
        : {}),
      ...(provider.type === 'openai' && provider.project
        ? { 'OpenAI-Project': provider.project }
        : {}),
      ...(provider.type === 'openrouter' ? this.openRouterHeaders(provider) : {}),
    }
  }

  private openRouterHeaders(provider: ProviderConfig) {
    return {
      ...(provider.siteURL ? { 'HTTP-Referer': provider.siteURL } : {}),
      ...(provider.appName ? { 'X-OpenRouter-Title': provider.appName } : {}),
    }
  }

  private async listAnthropicModels(
    endpoint: string,
    headers: Record<string, string>,
    name: string,
  ) {
    const models: string[] = []
    let afterId: string | undefined
    while (true) {
      const url = new URL(endpoint)
      url.searchParams.set('limit', '1000')
      if (afterId) url.searchParams.set('after_id', afterId)
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`${name} returned ${response.status}`)
      const result: unknown = await response.json()
      if (
        !result ||
        typeof result !== 'object' ||
        !('data' in result) ||
        !Array.isArray(result.data)
      ) {
        throw new Error(`${name} returned an invalid model list`)
      }
      models.push(
        ...result.data.flatMap((item: unknown) =>
          item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'
            ? [item.id]
            : [],
        ),
      )
      if (!('has_more' in result) || result.has_more !== true) return models
      if (
        !('last_id' in result) ||
        typeof result.last_id !== 'string' ||
        result.last_id === afterId
      ) {
        throw new Error(`${name} returned an invalid pagination cursor`)
      }
      afterId = result.last_id
    }
  }

  private async ensureLMStudioContext(
    provider: ProviderConfig,
    modelId: string | undefined,
    unloadOtherModels: boolean,
  ) {
    const root = providerRoot(provider)
    const headers = this.headers(provider)
    const response = await fetch(`${root}/api/v1/models`, { headers })
    if (!response.ok) throw new Error(`${provider.name} model status returned ${response.status}`)
    const result: unknown = await response.json()
    if (
      !result ||
      typeof result !== 'object' ||
      !('models' in result) ||
      !Array.isArray(result.models)
    ) {
      throw new Error(`${provider.name} returned an invalid model list`)
    }
    const allModels = result.models as Array<{ key?: unknown; loaded_instances?: unknown }>
    const model = modelId === undefined ? undefined : allModels.find((item) => item.key === modelId)
    const instances =
      model &&
      typeof model === 'object' &&
      'loaded_instances' in model &&
      Array.isArray(model.loaded_instances)
        ? (model.loaded_instances as Array<{ id?: unknown; config?: { context_length?: unknown } }>)
        : []
    const contextMatches =
      modelId === undefined ||
      !provider.contextLength ||
      (instances.length === 1 && instances[0].config?.context_length === provider.contextLength)
    if (
      contextMatches &&
      (!unloadOtherModels ||
        allModels.every(
          (item) =>
            item.key === modelId ||
            !Array.isArray(item.loaded_instances) ||
            item.loaded_instances.length === 0,
        ))
    )
      return

    for (const item of allModels) {
      const isSelected = modelId !== undefined && item.key === modelId
      if (isSelected && contextMatches) continue
      if (!isSelected && !unloadOtherModels) continue
      const loadedInstances = Array.isArray(item.loaded_instances)
        ? (item.loaded_instances as Array<{ id?: unknown }>)
        : []
      for (const instance of loadedInstances) {
        if (typeof instance.id !== 'string') continue
        const unload = await fetch(`${root}/api/v1/models/unload`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ instance_id: instance.id }),
        })
        if (!unload.ok)
          throw new Error(
            `${provider.name} could not unload ${String(item.key)} (${unload.status})`,
          )
      }
    }

    if (modelId === undefined || !provider.contextLength) return
    const load = await fetch(`${root}/api/v1/models/load`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId, context_length: provider.contextLength }),
    })
    if (!load.ok) throw new Error(`${provider.name} could not load ${modelId} (${load.status})`)
  }

  private async ensureOllamaExclusiveModel(provider: ProviderConfig, modelId?: string) {
    const root = providerRoot(provider)
    const headers = this.headers(provider)
    const status = await fetch(`${root}/api/ps`, { headers })
    if (!status.ok) throw new Error(`${provider.name} model status returned ${status.status}`)
    const result: unknown = await status.json()
    if (!isRecord(result) || !Array.isArray(result.models))
      throw new Error(`${provider.name} returned an invalid loaded-model list`)

    for (const value of result.models) {
      if (!isRecord(value)) continue
      const loadedName = typeof value.model === 'string' ? value.model : value.name
      if (typeof loadedName !== 'string' || loadedName === modelId) continue
      const unload = await fetch(`${root}/api/generate`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: loadedName, prompt: '', keep_alive: 0 }),
      })
      if (!unload.ok)
        throw new Error(`${provider.name} could not unload ${loadedName} (${unload.status})`)
      await unload.text()
    }
  }

  private releaseModelLease(lease: ModelContextLease) {
    lease.active--
    if (lease.active === 0) this.wakeModelWaiters(lease)
  }

  private wakeModelWaiters(lease: ModelContextLease) {
    for (const wake of lease.waiters.splice(0)) wake()
  }

  private waitForModelLease(lease: ModelContextLease, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        return
      }
      const wake = () => {
        signal?.removeEventListener('abort', abort)
        resolve()
      }
      const abort = () => {
        lease.waiters = lease.waiters.filter((waiter) => waiter !== wake)
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      lease.waiters.push(wake)
      signal?.addEventListener('abort', abort, { once: true })
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function providerRoot(provider: ProviderConfig) {
  return provider.baseURL.replace(/\/+$/, '').replace(/\/v1$/i, '')
}
