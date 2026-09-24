import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import { Field, SectionHeading, selectClass } from '@/components/settings/settings-field'
import type { McpServerConfig } from '@/services/mcp-service'
import {
  assertMcpOAuthServerUrl,
  clearMcpOAuth,
  defaultMcpOAuthCallbackPort,
  hasMcpOAuthTokens,
  signInMcpServer,
} from '@/services/mcp-oauth'
import { useAppStore } from '@/stores/app-store'

type McpDraft = {
  id?: string
  name: string
  transport: McpServerConfig['transport']
  command: string
  args: string
  url: string
  env: string
  headers: string
  auth: 'none' | 'oauth'
  oauthClientId: string
  oauthClientSecret: string
  oauthCallbackPort: string
  oauthCallbackHttps: boolean
}

const emptyDraft: McpDraft = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  env: '',
  headers: '',
  auth: 'none',
  oauthClientId: '',
  oauthClientSecret: '',
  oauthCallbackPort: String(defaultMcpOAuthCallbackPort),
  oauthCallbackHttps: false,
}

function parseLines(value: string) {
  const pairs: Record<string, string> = {}
  for (const line of value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)) {
    const separator = line.indexOf('=')
    if (separator < 1) throw new Error(`Use KEY=VALUE lines; invalid line: ${line}`)
    pairs[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return pairs
}

function draftFor(server: McpServerConfig): McpDraft {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command ?? '',
    args: (server.args ?? []).join('\n'),
    url: server.url ?? '',
    env: Object.entries(server.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    headers: Object.entries(server.headers ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    auth: server.auth ?? 'none',
    oauthClientId: server.oauthClientId ?? '',
    oauthClientSecret: server.oauthClientSecret ?? '',
    oauthCallbackPort: String(server.oauthCallbackPort ?? defaultMcpOAuthCallbackPort),
    oauthCallbackHttps: server.oauthCallbackHttps ?? false,
  }
}

function connectionConfig(server: McpServerConfig) {
  return JSON.stringify([
    server.transport,
    server.command,
    server.args,
    server.env,
    server.url,
    server.headers,
    server.auth,
    server.oauthClientId,
    server.oauthClientSecret,
    server.oauthCallbackPort,
    server.oauthCallbackHttps,
  ])
}

export function McpSettingsSection() {
  const servers = useAppStore((state) => state.settings.mcpServers)
  const status = useAppStore((state) => state.mcpServerStatus)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const checkServer = useAppStore((state) => state.checkMcpServer)
  const [draft, setDraft] = useState<McpDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [signingInId, setSigningInId] = useState<string | null>(null)
  const [oauthError, setOAuthError] = useState<{ id: string; message: string } | null>(null)
  const [, refreshOAuthStatus] = useState(0)
  const attemptedDiscovery = useRef(new Set<string>())

  useEffect(() => {
    for (const server of servers) {
      if (
        !server.enabled ||
        server.availableTools !== undefined ||
        attemptedDiscovery.current.has(server.id) ||
        (server.auth === 'oauth' && !hasMcpOAuthTokens(server))
      ) {
        continue
      }
      attemptedDiscovery.current.add(server.id)
      void checkServer(server.id)
    }
  }, [servers, checkServer])

  async function signIn(server: McpServerConfig) {
    setSigningInId(server.id)
    setOAuthError(null)
    try {
      await signInMcpServer(server)
      refreshOAuthStatus((value) => value + 1)
      await checkServer(server.id)
    } catch (reason) {
      setOAuthError({
        id: server.id,
        message: reason instanceof Error ? reason.message : String(reason),
      })
    } finally {
      setSigningInId(null)
    }
  }

  function updateServer(id: string, update: (server: McpServerConfig) => McpServerConfig) {
    updateSettings({
      mcpServers: servers.map((server) => (server.id === id ? update(server) : server)),
    })
  }

  function saveServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return

    try {
      if (!draft.name.trim()) throw new Error('Give the server a name.')
      if (draft.transport === 'stdio' && !draft.command.trim()) {
        throw new Error('Enter a command for the stdio server.')
      }
      if (draft.transport !== 'stdio' && !/^https?:$/.test(new URL(draft.url).protocol)) {
        throw new Error('Use an HTTP or HTTPS URL.')
      }
      if (draft.transport !== 'stdio' && draft.auth === 'oauth') {
        assertMcpOAuthServerUrl(new URL(draft.url))
      }
      const callbackPort = Number(draft.oauthCallbackPort)
      if (
        draft.transport !== 'stdio' &&
        draft.auth === 'oauth' &&
        (!Number.isInteger(callbackPort) || callbackPort < 1024 || callbackPort > 65535)
      ) {
        throw new Error('OAuth callback port must be between 1024 and 65535.')
      }

      const existing = servers.find((server) => server.id === draft.id)
      const server: McpServerConfig = {
        id: draft.id ?? crypto.randomUUID(),
        name: draft.name.trim(),
        transport: draft.transport,
        enabled: existing?.enabled ?? true,
        disabledTools: existing?.disabledTools ?? [],
        ...(draft.transport === 'stdio'
          ? {
              command: draft.command.trim(),
              args: draft.args
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean),
              env: parseLines(draft.env),
            }
          : {
              url: draft.url.trim(),
              headers: parseLines(draft.headers),
              auth: draft.auth,
              ...(draft.auth === 'oauth'
                ? {
                    oauthClientId: draft.oauthClientId.trim() || undefined,
                    oauthClientSecret: draft.oauthClientSecret.trim() || undefined,
                    oauthCallbackPort: callbackPort,
                    oauthCallbackHttps: draft.oauthCallbackHttps,
                  }
                : {}),
            }),
      }
      server.availableTools =
        existing && connectionConfig(existing) === connectionConfig(server)
          ? existing.availableTools
          : undefined
      attemptedDiscovery.current.delete(server.id)

      if (
        existing &&
        (existing.url !== server.url ||
          existing.auth !== server.auth ||
          existing.oauthClientId !== server.oauthClientId ||
          existing.oauthClientSecret !== server.oauthClientSecret ||
          (existing.oauthCallbackPort ?? defaultMcpOAuthCallbackPort) !== server.oauthCallbackPort ||
          (existing.oauthCallbackHttps ?? false) !== server.oauthCallbackHttps)
      ) {
        clearMcpOAuth(existing.id)
      }

      updateSettings({
        mcpServers: existing
          ? servers.map((item) => (item.id === server.id ? server : item))
          : [...servers, server],
      })
      setDraft(null)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <section id="mcp" className="scroll-mt-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <SectionHeading
          title="MCP servers"
          description="Connect trusted local or remote servers. MCP tools run with the server’s own permissions, outside chat-folder restrictions."
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDraft({ ...emptyDraft })
            setError(null)
          }}
        >
          <Plus /> Add server
        </Button>
      </div>

      {servers.length === 0 && (
        <p className="text-sm text-muted-foreground">No MCP servers configured.</p>
      )}
      {servers.map((server) => {
        const current = status[server.id]
        const oauthConnected = server.auth === 'oauth' && hasMcpOAuthTokens(server)
        return (
          <Card key={server.id} id={`mcp-${server.id}`} className="scroll-mt-4">
            <CardHeader>
              <div className="min-w-0">
                <CardTitle className="truncate">{server.name}</CardTitle>
                <CardDescription>
                  {server.transport === 'stdio'
                    ? `${server.command} ${(server.args ?? []).join(' ')}`
                    : server.url}
                </CardDescription>
              </div>
              <CardAction className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft(draftFor(server))
                    setError(null)
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${server.name}`}
                  onClick={() => setRemoveId(server.id)}
                >
                  <Trash2 />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3">
              {server.transport !== 'stdio' && server.auth === 'oauth' && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    {oauthConnected ? 'OAuth connected' : 'OAuth sign-in required'}
                  </span>
                  {oauthConnected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        clearMcpOAuth(server.id)
                        refreshOAuthStatus((value) => value + 1)
                      }}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={signingInId !== null}
                      onClick={() => void signIn(server)}
                    >
                      {signingInId === server.id && <LoaderCircle className="animate-spin" />}
                      Sign in
                    </Button>
                  )}
                </div>
              )}
              {oauthError?.id === server.id && (
                <p role="alert" className="text-sm text-destructive">
                  {oauthError.message}
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={server.enabled}
                    onCheckedChange={(checked) => {
                      updateServer(server.id, (item) => ({ ...item, enabled: checked === true }))
                    }}
                  />
                  Enabled
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={current?.loading}
                  onClick={() => void checkServer(server.id)}
                >
                  {current?.loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                  Test connection
                </Button>
              </div>
              {current?.error && (
                <p role="alert" className="text-sm text-destructive">
                  {current.error}
                </p>
              )}
              {server.availableTools && (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground">Available tools</p>
                  {server.availableTools.length ? (
                    <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                      {server.availableTools.map((name) => (
                        <label key={name} className="flex cursor-pointer items-center gap-3 py-2 text-sm">
                          <Checkbox
                            checked={!server.disabledTools?.includes(name)}
                            onCheckedChange={(checked) =>
                              updateServer(server.id, (item) => ({
                                ...item,
                                disabledTools:
                                  checked === true
                                    ? item.disabledTools?.filter((tool) => tool !== name)
                                    : [...(item.disabledTools ?? []), name],
                              }))
                            }
                          />
                          {name}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">This server exposes no tools.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}

      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (!open) setDraft(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit MCP server' : 'Add MCP server'}</DialogTitle>
            <DialogDescription>
              Only connect servers you trust. Local servers can run commands; remote servers receive
              tool requests.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <form className="max-h-[65vh] space-y-4 overflow-y-auto pr-1" onSubmit={saveServer}>
              <Field label="Name">
                <Input
                  required
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field label="Transport">
                <select
                  className={`${selectClass} w-full`}
                  value={draft.transport}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      transport: event.target.value as McpServerConfig['transport'],
                    })
                  }
                >
                  <option value="stdio">Local command (stdio)</option>
                  <option value="http">Streamable HTTP</option>
                  <option value="sse">SSE (legacy)</option>
                </select>
              </Field>
              {draft.transport === 'stdio' ? (
                <>
                  <Field label="Command">
                    <Input
                      required
                      value={draft.command}
                      onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                      placeholder="npx"
                    />
                  </Field>
                  <Field label="Arguments" description="One argument per line.">
                    <Textarea
                      value={draft.args}
                      onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                      rows={3}
                    />
                  </Field>
                  <Field
                    label="Environment"
                    description="Optional KEY=VALUE lines. Secrets are stored locally."
                  >
                    <Textarea
                      value={draft.env}
                      onChange={(event) => setDraft({ ...draft, env: event.target.value })}
                      rows={3}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Server URL">
                    <Input
                      required
                      type="url"
                      value={draft.url}
                      onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                      placeholder="https://example.com/mcp"
                    />
                  </Field>
                  <Field
                    label="Request headers"
                    description="Optional KEY=VALUE lines, such as Authorization=Bearer token."
                  >
                    <Textarea
                      value={draft.headers}
                      onChange={(event) => setDraft({ ...draft, headers: event.target.value })}
                      rows={3}
                    />
                  </Field>
                  <Field label="Authentication">
                    <select
                      className={`${selectClass} w-full`}
                      value={draft.auth}
                      onChange={(event) =>
                        setDraft({ ...draft, auth: event.target.value as McpDraft['auth'] })
                      }
                    >
                      <option value="none">None / request headers</option>
                      <option value="oauth">OAuth (browser sign-in)</option>
                    </select>
                  </Field>
                  {draft.auth === 'oauth' && (
                    <>
                      <Field
                        label="Client ID"
                        description="Optional; leave blank for dynamic registration."
                      >
                        <Input
                          value={draft.oauthClientId}
                          onChange={(event) =>
                            setDraft({ ...draft, oauthClientId: event.target.value })
                          }
                        />
                      </Field>
                      {draft.oauthClientId && (
                        <Field
                          label="Client secret"
                          description="Optional for pre-registered clients. Stored locally without OS keychain encryption."
                        >
                          <Input
                            type="password"
                            value={draft.oauthClientSecret}
                            onChange={(event) =>
                              setDraft({ ...draft, oauthClientSecret: event.target.value })
                            }
                          />
                        </Field>
                      )}
                      <Field
                        label="Callback port"
                        description={`Register ${draft.oauthCallbackHttps ? 'https' : 'http'}://127.0.0.1:${draft.oauthCallbackPort || defaultMcpOAuthCallbackPort}/mcp-oauth/callback as the redirect URI when using a client ID.`}
                      >
                        <Input
                          type="number"
                          min={1024}
                          max={65535}
                          value={draft.oauthCallbackPort}
                          onChange={(event) =>
                            setDraft({ ...draft, oauthCallbackPort: event.target.value })
                          }
                        />
                      </Field>
                      <label className="flex items-start gap-2 text-sm">
                        <Checkbox
                          checked={draft.oauthCallbackHttps}
                          onCheckedChange={(checked) =>
                            setDraft({ ...draft, oauthCallbackHttps: checked === true })
                          }
                        />
                        <span>
                          Use HTTPS callback
                          <span className="block text-xs text-muted-foreground">
                            Uses a local self-signed certificate. To finish sign-in, proceed through the browser warning only for https://127.0.0.1.
                          </span>
                        </span>
                      </label>
                    </>
                  )}
                </>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="submit">Save server</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(removeId)}
        onOpenChange={(open) => {
          if (!open) setRemoveId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove MCP server?</DialogTitle>
            <DialogDescription>
              This removes its configuration and disables its tools for future generations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (removeId) clearMcpOAuth(removeId)
                updateSettings({ mcpServers: servers.filter((server) => server.id !== removeId) })
                setRemoveId(null)
              }}
            >
              Remove server
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
