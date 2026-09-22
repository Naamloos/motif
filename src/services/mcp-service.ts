import { createMCPClient, type MCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import type { Tool } from 'ai'
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
  disabledTools?: string[]
  availableTools?: string[]
}

function transportFor(server: McpServerConfig) {
  if (server.transport === 'stdio') {
    if (!server.command?.trim()) throw new Error('An MCP command is required.')
    return new Experimental_StdioMCPTransport({
      command: server.command.trim(),
      args: server.args ?? [],
      env: { ...process.env, ...server.env } as Record<string, string>,
    })
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

export async function connectMcpServer(server: McpServerConfig): Promise<MCPClient> {
  const transport = transportFor(server)
  try {
    return await createMCPClient({
      transport,
      clientName: 'Motif',
      initializationOptions: { timeout: 15_000 },
    })
  } catch (error) {
    if (transport instanceof Experimental_StdioMCPTransport) await transport.close()
    throw error
  }
}

export async function inspectMcpServer(server: McpServerConfig): Promise<string[]> {
  const client = await connectMcpServer(server)
  try {
    return (await client.listTools({ options: { timeout: 15_000 } })).tools.map((item) => item.name)
  } finally {
    await client.close()
  }
}

export async function createMcpToolSession(
  servers: McpServerConfig[],
  onStatus: (id: string, error: string | null, tools?: string[]) => void,
) {
  const clients: MCPClient[] = []
  const tools: Record<string, Tool> = {}
  await Promise.all(
    servers
      .filter((server) => server.enabled)
      .map(async (server) => {
        try {
          const client = await connectMcpServer(server)
          clients.push(client)
          const discovered = await client.tools()
          let index = 0
          for (const [name, mcpTool] of Object.entries(discovered)) {
            if (server.disabledTools?.includes(name)) continue
            const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 35)
            tools[`mcp_${server.id.replace(/-/g, '').slice(0, 8)}_${index++}_${safeName}`] =
              mcpTool as Tool
          }
          onStatus(server.id, null, Object.keys(discovered))
        } catch (error) {
          onStatus(server.id, error instanceof Error ? error.message : String(error))
        }
      }),
  )
  return {
    tools,
    close: async () => {
      await Promise.allSettled(clients.map((client) => client.close()))
    },
  }
}
