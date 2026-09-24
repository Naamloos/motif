import { createMCPClient, mcpAppClientCapabilities, type MCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { Tool } from 'ai'
import type { ToolTrace } from '@/stores/app-model'
import { assertMcpOAuthServerUrl, hasMcpOAuthTokens, mcpOAuthProvider } from '@/services/mcp-oauth'

export type McpServerConfig = {
  id: string
  name: string
  transport: 'stdio' | 'http' | 'sse'
  enabled: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  auth?: 'none' | 'oauth'
  oauthClientId?: string
  oauthClientSecret?: string
  oauthCallbackPort?: number
  oauthCallbackHttps?: boolean
  disabledTools?: string[]
  availableTools?: string[]
}

function transportFor(
  server: McpServerConfig,
  cwd?: string,
  diagnostics?: { stderr: string; exitCode?: number | null },
) {
  if (server.transport === 'stdio') {
    if (!server.command?.trim()) throw new Error('An MCP command is required.')
    const command = server.command.trim()
    const winGetCommand =
      process.platform === 'win32' && process.env.LOCALAPPDATA && !/[\\/]/.test(command)
        ? join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', `${command}.exe`)
        : null
    const transport = new Experimental_StdioMCPTransport({
      command: winGetCommand && existsSync(winGetCommand) ? winGetCommand : command,
      args: server.args ?? [],
      cwd,
      env: server.env,
      stderr: 'pipe',
    })
    const start = transport.start.bind(transport)
    transport.start = () => {
      const started = start()
      const child = (transport as unknown as { process?: ChildProcess }).process
      child?.stderr?.on('data', (chunk) => {
        if (diagnostics) diagnostics.stderr = (diagnostics.stderr + String(chunk)).slice(-4096)
      })
      child?.on('close', (code) => {
        if (diagnostics) diagnostics.exitCode = code
      })
      return started
    }
    return transport
  }
  const url = new URL(server.url ?? '')
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('MCP server URL must use HTTP or HTTPS.')
  if (server.auth === 'oauth') assertMcpOAuthServerUrl(url)
  if (server.auth === 'oauth' && !hasMcpOAuthTokens(server)) {
    throw new Error(`Sign in to ${server.name} from MCP settings.`)
  }
  return {
    type: server.transport,
    url: url.toString(),
    headers: server.headers ?? {},
    ...(server.auth === 'oauth' ? { authProvider: mcpOAuthProvider(server) } : {}),
  } as const
}

export async function connectMcpServer(server: McpServerConfig, cwd?: string): Promise<MCPClient> {
  const diagnostics = { stderr: '', exitCode: undefined as number | null | undefined }
  const transport = transportFor(server, cwd, diagnostics)
  try {
    return await createMCPClient({
      transport,
      clientName: 'Motif',
      capabilities: mcpAppClientCapabilities,
      initializationOptions: { timeout: 15_000 },
    })
  } catch (error) {
    if (transport instanceof Experimental_StdioMCPTransport) await transport.close()
    if (diagnostics.stderr.trim() || diagnostics.exitCode !== undefined) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${diagnostics.exitCode !== undefined ? `\nProcess exited with code ${diagnostics.exitCode}` : ''}${diagnostics.stderr.trim() ? `\n${diagnostics.stderr.trim()}` : ''}`,
        { cause: error },
      )
    }
    throw error
  }
}

export async function inspectMcpServer(server: McpServerConfig, cwd?: string): Promise<string[]> {
  const client = await connectMcpServer(server, cwd)
  try {
    return (await client.listTools({ options: { timeout: 15_000 } })).tools.map((item) => item.name)
  } finally {
    await client.close()
  }
}

export async function createMcpToolSession(
  servers: McpServerConfig[],
  onStatus: (id: string, error: string | null, tools?: string[]) => void,
  cwd?: string,
) {
  const clients: MCPClient[] = []
  const tools: Record<string, Tool> = {}
  const apps: Record<string, NonNullable<ToolTrace['app']>> = {}
  const serversByTool: Record<string, string> = {}
  await Promise.all(
    servers
      .filter((server) => server.enabled)
      .map(async (server) => {
        try {
          const client = await connectMcpServer(server, cwd)
          clients.push(client)
          const definitions = await client.listTools()
          const discovered = await client.toolsFromDefinitions(definitions)
          let index = 0
          let uiError: string | null = null
          for (const [name, mcpTool] of Object.entries(discovered)) {
            if (server.disabledTools?.includes(name)) continue
            const definition = definitions.tools.find((item) => item.name === name)
            const ui = definition?._meta?.['ui'] as
              { resourceUri?: string; visibility?: string[] } | undefined
            if (ui?.visibility && !ui.visibility.includes('model')) continue
            const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 35)
            const toolName = `mcp_${server.id.replace(/-/g, '').slice(0, 8)}_${index++}_${safeName}`
            serversByTool[toolName] = server.id
            const uri = ui?.resourceUri ?? definition?._meta?.['ui/resourceUri']
            if (typeof uri === 'string' && uri.startsWith('ui://')) {
              try {
                const resource = (
                  await client.readResource({ uri, options: { timeout: 15_000 } })
                ).contents.find((item) => item.uri === uri)
                const html: string | undefined =
                  resource && 'text' in resource
                    ? typeof resource.text === 'string' ? resource.text : undefined
                    : resource && 'blob' in resource
                      ? typeof resource.blob === 'string' ? Buffer.from(resource.blob, 'base64').toString('utf8') : undefined
                      : undefined
                if (html && resource?.mimeType === 'text/html;profile=mcp-app') {
                  const meta = (resource._meta as Record<string, unknown> | undefined)?.['ui'] as
                    { csp?: NonNullable<ToolTrace['app']>['csp'] } | undefined
                  apps[toolName] = {
                    uri,
                    mimeType: resource.mimeType,
                    html,
                    serverId: server.id,
                    toolName: name,
                    csp: meta?.csp,
                  }
                }
              } catch (error) {
                uiError = `Could not load MCP app ${name}: ${String(error)}`
              }
            }
            tools[toolName] = {
              ...mcpTool,
              toModelOutput: ({
                output,
                ...options
              }: Parameters<NonNullable<typeof mcpTool.toModelOutput>>[0]) => {
                const filtered =
                  output &&
                  typeof output === 'object' &&
                  'content' in output &&
                  Array.isArray(output.content)
                    ? {
                        ...output,
                        content: output.content.filter(
                          (item) =>
                            !item ||
                            typeof item !== 'object' ||
                            !('type' in item) ||
                            item.type !== 'resource' ||
                            !('resource' in item) ||
                            !item.resource ||
                            typeof item.resource !== 'object' ||
                            !('uri' in item.resource) ||
                            typeof item.resource.uri !== 'string' ||
                            !item.resource.uri.startsWith('ui://'),
                        ),
                      }
                    : output
                if (
                  filtered &&
                  typeof filtered === 'object' &&
                  'content' in filtered &&
                  Array.isArray(filtered.content) &&
                  filtered.content.length === 0
                ) {
                  filtered.content.push({
                    type: 'text',
                    text: 'The tool returned an interactive UI.',
                  })
                }
                return mcpTool.toModelOutput
                  ? mcpTool.toModelOutput({ ...options, output: filtered })
                  : { type: 'json', value: filtered }
              },
            } as Tool
          }
          onStatus(server.id, uiError, Object.keys(discovered))
        } catch (error) {
          onStatus(server.id, error instanceof Error ? error.message : String(error))
        }
      }),
  )
  return {
    tools,
    apps,
    serversByTool,
    close: async () => {
      await Promise.allSettled(clients.map((client) => client.close()))
    },
  }
}
