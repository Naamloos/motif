import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, SectionHeading, selectClass } from '@/components/settings/settings-field'
import { McpSettingsSection } from '@/components/settings/mcp-settings-section'
import { ProviderSettingsCard, providerLabels } from '@/components/settings/provider-settings-card'
import { useAppStore } from '@/stores/app-store'
import type { ProviderType } from '@/services/ai-service'

const tools = {
  getModelName: 'Get model name',
  searchWikipedia: 'Search Wikipedia',
  searchWeb: 'Search the web',
  fetchWebpage: 'Fetch webpage',
  listFiles: 'List files',
  searchFiles: 'Search files',
  readFile: 'Read file',
  readDocument: 'Read document',
  writeFile: 'Write file',
  patchFile: 'Patch file',
  runCommand: 'Run command',
  askUser: 'Ask the user',
  manageTasks: 'Manage chat checklist',
  searchChats: 'Search chats',
  saveMemory: 'Save memory',
  openInBrowser: 'Open in browser',
  ocrImage: 'Read text in images (OCR)',
}
export default function SettingsPage() {
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLElement>(null)
  const [isAtTop, setIsAtTop] = useState(true)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const settings = useAppStore((state) => state.settings)
  const setMax = useAppStore((state) => state.setMaxConcurrentGenerations)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const addProvider = useAppStore((state) => state.addProvider)
  const persistenceError = useAppStore((state) => state.persistenceError)
  const [addOpen, setAddOpen] = useState(false)
  const [providerType, setProviderType] = useState<ProviderType>('lmstudio')
  const [providerName, setProviderName] = useState('LM Studio')
  const edgeMask = `linear-gradient(to bottom, ${isAtTop ? 'black 0%' : 'transparent 0%, black 40px'}, ${isAtBottom ? 'black 100%' : 'black calc(100% - 40px), transparent 100%'})`

  function updateScrollEdges() {
    const viewport = scrollRef.current
    if (!viewport) return
    setIsAtTop(viewport.scrollTop < 8)
    setIsAtBottom(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 32)
  }

  useLayoutEffect(updateScrollEdges)

  function createProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    addProvider(providerType, providerName)
    setProviderType('lmstudio')
    setProviderName('LM Studio')
    setAddOpen(false)
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to chats"
            title="Back to chats"
            onClick={() => navigate('/')}
          >
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Settings</h1>
          </div>
        </div>
        <Button variant="outline" onClick={() => setAddOpen(true)}>
          <Plus /> Add provider
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden p-4 md:block">
          <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Preferences
          </p>
          <a className="block rounded-md px-2 py-2 text-sm hover:bg-muted" href="#appearance">
            Appearance
          </a>
          <a className="block rounded-md px-2 py-2 text-sm hover:bg-muted" href="#generation">
            Generation
          </a>
          <a className="block rounded-md px-2 py-2 text-sm hover:bg-muted" href="#tools">
            Tools
          </a>
          <p className="mb-2 mt-6 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Connections
          </p>
          <a className="block rounded-md px-2 py-2 text-sm hover:bg-muted" href="#providers">
            Providers
          </a>
          {settings.providers.map((provider) => (
            <a
              key={provider.id}
              className="block truncate rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              href={`#provider-${provider.id}`}
            >
              {provider.name}
            </a>
          ))}
          <a className="block rounded-md px-2 py-2 text-sm hover:bg-muted" href="#mcp">
            MCP servers
          </a>
          {settings.mcpServers.map((server) => (
            <a
              key={server.id}
              className="block truncate rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              href={`#mcp-${server.id}`}
            >
              {server.name}
            </a>
          ))}
        </nav>

        <main
          ref={scrollRef}
          onScroll={updateScrollEdges}
          className="min-h-0 space-y-6 overflow-y-auto p-4 md:p-6"
          style={{ maskImage: edgeMask, WebkitMaskImage: edgeMask }}
        >
          <section id="appearance" className="scroll-mt-4">
            <SectionHeading
              title="Appearance"
              description="Choose how Motif looks on this device."
            />
            <Card>
              <CardContent className="grid gap-5 pt-6 sm:grid-cols-2">
                <Field
                  label="Theme"
                  description="Follow your system preference or choose a fixed theme."
                >
                  <select
                    className={selectClass}
                    value={settings.theme}
                    onChange={(event) =>
                      updateSettings({ theme: event.target.value as typeof settings.theme })
                    }
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </Field>
                <Field label="Primary color" description="Reset to the app default at any time.">
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="Custom primary color"
                      type="color"
                      className="h-8 w-14 cursor-pointer overflow-hidden border-0 p-0 shadow-none ring-0 outline-none appearance-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:border-0"
                      style={{ backgroundColor: settings.primaryColor || '#89d32c' }}
                      value={settings.primaryColor || '#89d32c'}
                      onChange={(event) => updateSettings({ primaryColor: event.target.value })}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateSettings({ primaryColor: '' })}
                    >
                      Reset
                    </Button>
                  </div>
                </Field>
              </CardContent>
            </Card>
          </section>

          <section id="generation" className="scroll-mt-4">
            <SectionHeading
              title="Generation"
              description="Set defaults for new chats and model responses."
            />
            <Card>
              <CardContent className="space-y-5 pt-6">
                <Field
                  label="Maximum simultaneous chats"
                  description="Additional chats wait in a queue."
                  horizontal
                >
                  <Input
                    aria-label="Maximum simultaneous chats"
                    type="number"
                    min={1}
                    max={8}
                    className="w-24"
                    value={settings.maxConcurrentGenerations}
                    onChange={(event) => setMax(Number(event.target.value))}
                  />
                </Field>
                <label className="flex cursor-pointer items-center justify-between gap-4">
                  <span>
                    <span className="block text-sm font-medium">
                      Unload other models when switching
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Unload models across configured LM Studio and Ollama providers before
                      generation.
                    </span>
                  </span>
                  <Checkbox
                    checked={settings.unloadOtherModelsOnSwitch}
                    onCheckedChange={(checked) =>
                      updateSettings({ unloadOtherModelsOnSwitch: checked === true })
                    }
                  />
                </label>
                <Field
                  label="Default provider"
                  description="Used when creating a new chat."
                  horizontal
                >
                  <select
                    className={`${selectClass} max-w-[60%]`}
                    value={settings.defaultProviderId}
                    onChange={(event) => updateSettings({ defaultProviderId: event.target.value })}
                  >
                    {settings.providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="System prompt" description="Instructions included with every chat.">
                  <Textarea
                    value={settings.systemPrompt}
                    onChange={(event) => updateSettings({ systemPrompt: event.target.value })}
                    rows={5}
                  />
                </Field>
              </CardContent>
            </Card>
          </section>

          <section id="tools" className="scroll-mt-4">
            <SectionHeading
              title="Tools"
              description="Choose which tools models may use during a chat."
            />
            <Card className="mb-4">
              <CardContent className="pt-6">
                <Field
                  label="SearXNG instance URL"
                  description="Required for web search. The instance must enable JSON results in its search formats."
                >
                  <Input
                    type="url"
                    autoComplete="off"
                    value={settings.searxngUrl}
                    onChange={(event) => updateSettings({ searxngUrl: event.target.value })}
                    placeholder="http://localhost:8080"
                  />
                </Field>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="grid grid-cols-1 gap-x-4 pt-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(tools).map(([id, label]) => (
                  <label key={id} className="flex cursor-pointer items-center gap-3 py-2 text-sm">
                    <Checkbox
                      checked={settings.enabledTools[id] ?? false}
                      onCheckedChange={(checked) =>
                        updateSettings({
                          enabledTools: { ...settings.enabledTools, [id]: checked === true },
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </CardContent>
            </Card>
            {settings.memories.length > 0 && (
              <Card>
                <CardContent className="space-y-2 pt-5">
                  <h3 className="text-sm font-medium">Saved memories</h3>
                  {settings.memories.map((memory, index) => (
                    <div
                      key={`${memory}-${index}`}
                      className="flex items-start justify-between gap-3 border-t pt-2 text-sm"
                    >
                      <span>{memory}</span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Remove saved memory"
                        onClick={() =>
                          updateSettings({
                            memories: settings.memories.filter((_, item) => item !== index),
                          })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </section>

          <section id="providers" className="scroll-mt-4 space-y-4">
            <SectionHeading
              title="Providers"
              description="Manage model endpoints and credentials. Each provider can use its own settings."
            />
            {settings.providers.map((provider) => (
              <ProviderSettingsCard
                key={provider.id}
                provider={provider}
                canRemove={settings.providers.length > 1}
              />
            ))}
          </section>
          <McpSettingsSection />
          {persistenceError && (
            <p role="alert" className="text-sm text-destructive">
              {persistenceError}
            </p>
          )}
        </main>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add provider</DialogTitle>
            <DialogDescription>Connect another model service.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={createProvider}>
            <Field label="Provider type">
              <select
                className={`${selectClass} w-full`}
                value={providerType}
                onChange={(event) => {
                  const type = event.target.value as ProviderType
                  setProviderType(type)
                  setProviderName(providerLabels[type])
                }}
              >
                {(
                  ['lmstudio', 'ollama', 'openai', 'anthropic', 'openrouter'] as ProviderType[]
                ).map((type) => (
                  <option key={type} value={type}>
                    {providerLabels[type]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name">
              <Input
                required
                value={providerName}
                onChange={(event) => setProviderName(event.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button type="submit">Add provider</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
