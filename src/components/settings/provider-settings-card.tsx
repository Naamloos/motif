import { useEffect, useState } from 'react'
import { LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Field, selectClass } from '@/components/settings/settings-field'
import type { ProviderConfig, ProviderType } from '@/services/ai-service'
import { useAppStore } from '@/stores/app-store'

export const providerLabels: Record<ProviderType, string> = {
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  google: 'Google',
  'codex-cli': 'Codex CLI',
}

export function ProviderSettingsCard({
  provider,
  canRemove,
}: {
  provider: ProviderConfig
  canRemove: boolean
}) {
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const saveURL = useAppStore((state) => state.saveProviderBaseURL)
  const refreshModels = useAppStore((state) => state.refreshModels)
  const refreshProviderUsage = useAppStore((state) => state.refreshProviderUsage)
  const refreshLoadedModels = useAppStore((state) => state.refreshLoadedModels)
  const unloadLoadedModel = useAppStore((state) => state.unloadLoadedModel)
  const setDefaultModel = useAppStore((state) => state.setDefaultModel)
  const updateProvider = useAppStore((state) => state.updateProvider)
  const removeProvider = useAppStore((state) => state.removeProvider)
  const loadedModels = useAppStore((state) => state.loadedModels[provider.id])
  const loadedError = useAppStore((state) => state.loadedModelErrors[provider.id])
  const loadingLoadedModels = useAppStore((state) => state.loadingLoadedModels[provider.id])
  const modelStatus = useAppStore((state) => state.modelRefreshStatus)
  const modelError = useAppStore((state) => state.modelRefreshError)
  const supportsUsage = provider.type === 'codex-cli' || provider.type === 'openrouter'
  const usage = useAppStore((state) => state.providerUsage[provider.id])
  const usageError = useAppStore((state) => state.providerUsageErrors[provider.id])
  const loadingUsage = useAppStore((state) => state.loadingProviderUsage[provider.id])
  const supportsLoaded = provider.type === 'lmstudio' || provider.type === 'ollama'

  useEffect(() => {
    if (supportsLoaded) void refreshLoadedModels(provider.id)
  }, [provider.id, provider.baseURL, refreshLoadedModels, supportsLoaded])

  useEffect(() => {
    if (provider.type === 'codex-cli' || (provider.type === 'openrouter' && provider.apiKey)) {
      void refreshProviderUsage(provider.id)
    }
  }, [provider.id, provider.apiKey, refreshProviderUsage, supportsUsage])

  function updateContextLength(value: string) {
    if (!value) {
      updateProvider(provider.id, { contextLength: undefined })
      return
    }
    const contextLength = Number(value)
    if (Number.isSafeInteger(contextLength) && contextLength > 0) {
      updateProvider(provider.id, { contextLength })
    }
  }

  return (
    <>
      <Card id={`provider-${provider.id}`} className="scroll-mt-4">
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="truncate">{provider.name}</CardTitle>
            <CardDescription>{providerLabels[provider.type]}</CardDescription>
          </div>
          {canRemove && (
            <CardAction>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${provider.name}`}
                title="Remove provider"
                onClick={() => setRemoveOpen(true)}
              >
                <Trash2 className="text-muted-foreground" />
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {provider.type !== 'codex-cli' && (
              <>
                <Input
                  aria-label={`${provider.name} endpoint`}
                  className="min-w-48 flex-1"
                  value={endpoint ?? provider.baseURL}
                  onChange={(event) => setEndpoint(event.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    if (saveURL(provider.id, endpoint ?? provider.baseURL)) setEndpoint(null)
                  }}
                >
                  Save endpoint
                </Button>
              </>
            )}
            <Button
              variant="outline"
              disabled={modelStatus === 'loading'}
              onClick={() => void refreshModels(provider.id)}
            >
              {modelStatus === 'loading' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Refresh models
            </Button>
          </div>

          {supportsUsage && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">
                    {provider.type === 'codex-cli' ? 'Usage limits' : 'Credits'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {usage?.type === 'codex-cli' && usage.limits.planType
                      ? `${usage.limits.planType} plan - `
                      : provider.type === 'codex-cli'
                        ? 'Codex account limits'
                        : 'OpenRouter account credits'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingUsage || (provider.type === 'openrouter' && !provider.apiKey)}
                  onClick={() => void refreshProviderUsage(provider.id)}
                >
                  {loadingUsage ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                  Refresh
                </Button>
              </div>
              {usageError && (
                <p role="alert" className="text-sm text-destructive">
                  {usageError}
                </p>
              )}
              {usage?.type === 'codex-cli' && (
                <div className="space-y-3">
                  {[usage.limits.primary, usage.limits.secondary].map((window, index) =>
                    window ? (
                      <div key={index} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span>{index === 0 ? 'Current window' : 'Longer window'}</span>
                          <span>{Math.max(0, 100 - window.usedPercent)}% remaining</span>
                        </div>
                        <Progress value={100 - window.usedPercent} />
                        <p className="text-xs text-muted-foreground">
                          {window.windowDurationMins
                            ? `Resets in ${window.windowDurationMins < 1440 ? `${window.windowDurationMins / 60} hours` : `${window.windowDurationMins / 1440} days`}`
                            : ''}
                          {window.resetsAt
                            ? ` - ${new Date(window.resetsAt * 1000).toLocaleString()}`
                            : ''}
                        </p>
                      </div>
                    ) : null,
                  )}
                  {!usage.limits.primary && !usage.limits.secondary && (
                    <p className="text-sm text-muted-foreground">No rate limits were reported.</p>
                  )}
                </div>
              )}
              {usage?.type === 'openrouter' && provider.apiKey && (
                <div className="space-y-1 text-sm">
                  <p>${(usage.totalCredits - usage.totalUsage).toFixed(2)} remaining</p>
                  <p className="text-xs text-muted-foreground">
                    ${usage.totalUsage.toFixed(2)} used of ${usage.totalCredits.toFixed(2)}{' '}
                    purchased
                  </p>
                </div>
              )}
              {provider.type === 'openrouter' && !provider.apiKey && (
                <p className="text-xs text-muted-foreground">
                  Requires an OpenRouter management key.
                </p>
              )}
            </div>
          )}

          {provider.type !== 'google' && provider.type !== 'codex-cli' && (
            <Field
              label="API key"
              description={
                supportsLoaded
                  ? 'Optional for local servers.'
                  : 'Stored in the local settings file.'
              }
            >
              <Input
                type="password"
                autoComplete="off"
                value={provider.apiKey ?? ''}
                onChange={(event) =>
                  updateProvider(provider.id, { apiKey: event.target.value || undefined })
                }
              />
            </Field>
          )}

          {provider.type === 'openai' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Organization ID">
                <Input
                  value={provider.organization ?? ''}
                  onChange={(event) => {
                    updateProvider(provider.id, { organization: event.target.value || undefined })
                  }}
                />
              </Field>
              <Field label="Project ID">
                <Input
                  value={provider.project ?? ''}
                  onChange={(event) => {
                    updateProvider(provider.id, { project: event.target.value || undefined })
                  }}
                />
              </Field>
            </div>
          )}

          {provider.type === 'openrouter' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Site URL">
                <Input
                  value={provider.siteURL ?? ''}
                  onChange={(event) => {
                    updateProvider(provider.id, { siteURL: event.target.value || undefined })
                  }}
                />
              </Field>
              <Field label="App name">
                <Input
                  value={provider.appName ?? ''}
                  onChange={(event) => {
                    updateProvider(provider.id, { appName: event.target.value || undefined })
                  }}
                />
              </Field>
            </div>
          )}

          {supportsLoaded && (
            <Field
              label="Context size (tokens)"
              description={
                provider.type === 'lmstudio'
                  ? 'Ensures the model is loaded with this context size before generation.'
                  : 'Sent as Ollama’s num_ctx option for each request.'
              }
              horizontal
            >
              <Input
                aria-label={`${providerLabels[provider.type]} context size`}
                type="number"
                min={1}
                step={1}
                className="w-32"
                value={provider.contextLength ?? ''}
                onChange={(event) => updateContextLength(event.target.value)}
              />
            </Field>
          )}

          <Field
            label="Default model"
            description="Used for new chats with this provider."
            horizontal
          >
            <select
              className={`${selectClass} max-w-[70%]`}
              value={provider.defaultModelId}
              onChange={(event) => setDefaultModel(provider.id, event.target.value)}
            >
              {provider.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </Field>

          {modelStatus === 'success' && (
            <p className="text-sm text-muted-foreground">Models refreshed.</p>
          )}
          {modelError && (
            <p role="alert" className="text-sm text-destructive">
              {modelError}
            </p>
          )}

          {supportsLoaded && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">Loaded models</h3>
                  <p className="text-xs text-muted-foreground">
                    Currently using memory on this server.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingLoadedModels}
                  onClick={() => void refreshLoadedModels(provider.id)}
                >
                  {loadingLoadedModels ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                  Refresh
                </Button>
              </div>
              {loadedError && (
                <p role="alert" className="text-sm text-destructive">
                  {loadedError}
                </p>
              )}
              {loadedModels?.length ? (
                <div className="divide-y rounded-md border">
                  {loadedModels.map((model, index) => (
                    <div
                      key={model.instanceId ?? `${model.modelId}-${index}`}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{model.modelId}</p>
                        <p className="text-xs text-muted-foreground">
                          {model.contextLength
                            ? `${model.contextLength.toLocaleString()} tokens`
                            : ''}
                          {model.size ? ` - ${(model.size / 1_000_000_000).toFixed(1)} GB` : ''}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void unloadLoadedModel(provider.id, model)}
                      >
                        Unload
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {loadingLoadedModels ? 'Loading...' : 'No models are currently loaded.'}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {provider.name}?</DialogTitle>
            <DialogDescription>
              Chats using this provider will be reassigned to another configured provider. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                removeProvider(provider.id)
                setRemoveOpen(false)
              }}
            >
              Remove provider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
