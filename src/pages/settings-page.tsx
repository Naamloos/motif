import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react'
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
  searchNews: 'Search news',
  searchImages: 'Search images',
  fetchWebpage: 'Fetch webpage',
  listFiles: 'List files',
  findFiles: 'Find files by name',
  findDefinition: 'Find code definitions',
  getFileTree: 'Show recursive file tree',
  inspectWorkspace: 'Inspect workspace and instructions',
  searchFiles: 'Search files',
  readFile: 'Read file',
  editFile: 'Edit numbered lines',
  readDocument: 'Read document',
  writeFile: 'Write file',
  patchFile: 'Patch file',
  runCommand: 'Run command',
  git: 'Inspect Git status, diffs, and history',
  askUser: 'Ask the user',
  manageTasks: 'Manage chat checklist',
  searchChats: 'Search chats',
  saveMemory: 'Save memory',
  manageMemories: 'Review, edit, or remove memories',
  openInBrowser: 'Open in browser',
  copyToClipboard: 'Copy to clipboard',
  readClipboard: 'Read clipboard',
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
  const [editingMemoryIndex, setEditingMemoryIndex] = useState<number | null>(null)
  const [memoryDraft, setMemoryDraft] = useState('')
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
      <header className="window-drag flex shrink-0 items-center justify-between px-6 py-4 pt-12">
        <div className="flex items-center gap-3">
          <Button
            className="window-no-drag"
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
                      style={{ backgroundColor: settings.primaryColor || '#0023ff' }}
                      value={settings.primaryColor || '#0023ff'}
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
                <Field
                  label="Maximum tool steps"
                  description="Maximum tool rounds per response (1–100). Default: 15."
                  horizontal
                >
                  <Input
                    aria-label="Maximum tool steps"
                    type="number"
                    min={1}
                    max={100}
                    className="w-24"
                    value={settings.maxToolSteps}
                    onChange={(event) =>
                      updateSettings({
                        maxToolSteps: Math.max(1, Math.min(100, Number(event.target.value) || 15)),
                      })
                    }
                  />
                </Field>
                <Field
                  label="Context turn limit"
                  description="Keep this many recent user turns in the model context. The visible transcript is preserved."
                  horizontal
                >
                  <Input
                    aria-label="Context turn limit"
                    type="number"
                    min={1}
                    max={100}
                    className="w-24"
                    value={settings.contextTurnLimit}
                    onChange={(event) => {
                      updateSettings({
                        contextTurnLimit: Math.max(
                          1,
                          Math.min(100, Number(event.target.value) || 20),
                        ),
                      })
                    }}
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
                <label className="mb-5 flex cursor-pointer items-center justify-between gap-4">
                  <span>
                    <span className="block text-sm font-medium">Approve file changes</span>
                    <span className="block text-xs text-muted-foreground">
                      Ask before tools write or patch files, even inside the selected folder.
                    </span>
                  </span>
                  <Checkbox
                    checked={settings.requireApprovalForFileChanges}
                    onCheckedChange={(checked) =>
                      updateSettings({ requireApprovalForFileChanges: checked === true })
                    }
                  />
                </label>
                <label className="mb-5 flex cursor-pointer items-center justify-between gap-4">
                  <span>
                    <span className="block text-sm font-medium">Approve commands</span>
                    <span className="block text-xs text-muted-foreground">
                      Ask before a tool runs a command in the chat folder or current directory.
                    </span>
                  </span>
                  <Checkbox
                    checked={settings.requireApprovalForCommands}
                    onCheckedChange={(checked) =>
                      updateSettings({ requireApprovalForCommands: checked === true })
                    }
                  />
                </label>
                <label className="mb-5 flex cursor-pointer items-center justify-between gap-4">
                  <span>
                    <span className="block text-sm font-medium">Approve browser actions</span>
                    <span className="block text-xs text-muted-foreground">
                      Ask before opening a URL in the system browser.
                    </span>
                  </span>
                  <Checkbox
                    checked={settings.requireApprovalForBrowser}
                    onCheckedChange={(checked) =>
                      updateSettings({ requireApprovalForBrowser: checked === true })
                    }
                  />
                </label>
                <label className="mb-5 flex cursor-pointer items-center justify-between gap-4">
                  <span>
                    <span className="block text-sm font-medium">Approve MCP tool calls</span>
                    <span className="block text-xs text-muted-foreground">
                      Ask before an MCP server runs a tool. Requests appear in approval history.
                    </span>
                  </span>
                  <Checkbox
                    checked={settings.requireApprovalForMcpTools}
                    onCheckedChange={(checked) =>
                      updateSettings({ requireApprovalForMcpTools: checked === true })
                    }
                  />
                </label>
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
            <Card className="mt-4">
              <CardContent className="space-y-3 pt-5">
                <h3 className="text-sm font-medium">Saved memories</h3>
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const form = event.currentTarget
                    const memory = new FormData(form).get('memory')?.toString().trim()
                    if (memory && !settings.memories.includes(memory)) {
                      updateSettings({ memories: [...settings.memories, memory] })
                    }
                    form.reset()
                  }}
                >
                  <Input
                    name="memory"
                    aria-label="Add a memory"
                    placeholder="Add a preference or fact"
                    maxLength={1000}
                  />
                  <Button type="submit" variant="outline">
                    Add
                  </Button>
                </form>
                {settings.memories.map((memory, index) => (
                  <div
                    key={`${memory}-${index}`}
                    className="flex items-start justify-between gap-3 border-t pt-2 text-sm"
                  >
                    <span>{memory}</span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit memory ${memory}`}
                      onClick={() => {
                        setEditingMemoryIndex(index)
                        setMemoryDraft(memory)
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove memory ${memory}`}
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
            <Card className="mt-4">
              <CardContent className="space-y-2 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium">Tool approval history</h3>
                  {settings.toolAudit.length > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => updateSettings({ toolAudit: [] })}
                    >
                      Clear history
                    </Button>
                  )}
                </div>
                {settings.toolAudit.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No approval requests yet.</p>
                ) : settings.toolAudit.slice().reverse().map((entry) => (
                  <div key={entry.id} className="border-t pt-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span>
                        {entry.action} - {entry.chatTitle}
                      </span>
                      <span className={entry.approved ? 'text-primary' : 'text-destructive'}>
                        {entry.approved ? 'Approved' : 'Denied'}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                      {entry.details}
                    </p>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={new Date(entry.at).toISOString()}
                    >
                      {new Date(entry.at).toLocaleString()}
                    </time>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <section id="providers" className="scroll-mt-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <SectionHeading
                title="Providers"
                description="Manage model endpoints and credentials. Each provider can use its own settings."
              />
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <Plus /> Add provider
              </Button>
            </div>
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
      <Dialog
        open={editingMemoryIndex !== null}
        onOpenChange={(open) => {
          if (!open) setEditingMemoryIndex(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit memory</DialogTitle>
            <DialogDescription>Update the saved preference or fact.</DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Edit memory text"
            value={memoryDraft}
            maxLength={1000}
            onChange={(event) => setMemoryDraft(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMemoryIndex(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editingMemoryIndex === null || !memoryDraft.trim()) return
                updateSettings({
                  memories: settings.memories.map((memory, index) =>
                    index === editingMemoryIndex ? memoryDraft.trim() : memory,
                  ),
                })
                setEditingMemoryIndex(null)
              }}
            >
              Save memory
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
                  [
                    'lmstudio',
                    'ollama',
                    'openai',
                    'anthropic',
                    'openrouter',
                    'codex-cli',
                  ] as ProviderType[]
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
