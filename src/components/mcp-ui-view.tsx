import { useMemo, useState } from 'react'
import { AppRenderer, type AppRendererProps } from '@mcp-ui/client'
import {
  UIResourceRenderer,
  remoteButtonDefinition,
  remoteCardDefinition,
  remoteImageDefinition,
  remoteStackDefinition,
  remoteTextDefinition,
} from '@mcp-ui/client-legacy'
import { connectMcpServer, type McpServerConfig } from '@/services/mcp-service'
import { useAppStore } from '@/stores/app-store'
import type { ToolTrace } from '@/stores/app-model'
import { useToolPromptStore } from '@/stores/tool-prompt-store'

type App = NonNullable<ToolTrace['app']>
const sandbox = {
  url: new URL(
    `data:text/html,${encodeURIComponent(`<!doctype html><script>
addEventListener('message', ({ data }) => {
  if (data?.method !== 'ui/notifications/sandbox-resource-ready') return;
  document.open();
  document.write(data.params.html);
  document.close();
});
parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} }, '*');
<\/script>`)}`,
  ),
  permissions: 'allow-scripts',
}
const remoteDomProps = {
  remoteElements: [
    remoteButtonDefinition,
    remoteCardDefinition,
    remoteImageDefinition,
    remoteStackDefinition,
    remoteTextDefinition,
  ],
}
const hostInfo = { name: 'Motif', version: '1.0.0' }
const hostCapabilities = { serverTools: {}, serverResources: {}, openLinks: {} }

function serverFor(app: App): { server: McpServerConfig; cwd?: string } {
  const state = useAppStore.getState()
  const server = state.settings.mcpServers.find((item) => item.id === app.serverId && item.enabled)
  if (!server) throw new Error('The MCP server for this UI is unavailable.')
  const cwd = state.chats.find((chat) => chat.id === state.activeChatId)?.workspaceFolder
  return { server, cwd }
}

async function callTool(app: App, name: string, args?: Record<string, unknown>) {
  const { server, cwd } = serverFor(app)
  const client = await connectMcpServer(server, cwd)
  try {
    const definition = (await client.listTools()).tools.find((item) => item.name === name)
    if (!definition || server.disabledTools?.includes(name))
      throw new Error(`MCP tool ${name} is unavailable.`)
    const visibility = (definition._meta?.ui as { visibility?: string[] } | undefined)?.visibility
    if (visibility && !visibility.includes('app'))
      throw new Error(`MCP tool ${name} is not available to apps.`)
    if (
      useAppStore.getState().settings.requireApprovalForMcpTools &&
      !(await useToolPromptStore
        .getState()
        .askApproval(`Use MCP tool: ${server.name}.${name}`, JSON.stringify(args ?? {}, null, 2)))
    )
      throw new Error('The user denied this MCP tool request.')
    return await client.callTool({ name, arguments: args })
  } finally {
    await client.close()
  }
}

async function readResource(app: App, uri: string) {
  const { server, cwd } = serverFor(app)
  const client = await connectMcpServer(server, cwd)
  try {
    return await client.readResource({ uri })
  } finally {
    await client.close()
  }
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export function McpUiView({ app, tool }: { app: App; tool: ToolTrace }) {
  const [error, setError] = useState<string | null>(null)
  const toolInput = useMemo(() => parseObject(tool.input), [tool.input])
  const toolResult = useMemo(() => parseObject(tool.output ?? ''), [tool.output])
  const resource = useMemo(
    () => ({
      uri: app.uri,
      // The built-in ui-* library renders in React; native custom elements are not registered here.
      mimeType: app.mimeType.replace(/framework=webcomponents/i, 'framework=react'),
      text: app.html,
    }),
    [app.uri, app.mimeType, app.html],
  )
  const openLink = (url: string) => {
    if (!/^https?:\/\//.test(url)) return false
    window.open(url, '_blank', 'noopener,noreferrer')
    return true
  }

  if (app.mimeType === 'text/html;profile=mcp-app') {
    return (
      <div className="h-96 min-w-0 max-w-full overflow-hidden rounded-lg border bg-background p-3">
        <AppRenderer
          toolName={app.toolName ?? tool.name}
          toolResourceUri={app.uri}
          html={app.html}
          sandbox={sandbox}
          toolInput={toolInput}
          toolResult={toolResult as AppRendererProps['toolResult']}
          hostInfo={hostInfo}
          hostCapabilities={hostCapabilities}
          onCallTool={async (params) =>
            (await callTool(app, params.name, params.arguments)) as Awaited<
              ReturnType<NonNullable<AppRendererProps['onCallTool']>>
            >
          }
          onReadResource={async ({ uri }) =>
            (await readResource(app, uri)) as Awaited<
              ReturnType<NonNullable<AppRendererProps['onReadResource']>>
            >
          }
          onOpenLink={async ({ url }) => ({ isError: !openLink(url) })}
          onError={(cause) => setError(cause.message)}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div
      className={`min-w-0 max-w-full rounded-lg border bg-background p-3 ${app.mimeType.startsWith('application/vnd.mcp-ui.remote-dom') ? 'min-h-80' : 'h-96'}`}
    >
      <UIResourceRenderer
        resource={resource}
        remoteDomProps={remoteDomProps}
        onUIAction={async (action) => {
          if (action.type === 'link') openLink(action.payload.url)
          if (action.type === 'tool')
            return callTool(app, action.payload.toolName, action.payload.params)
        }}
        htmlProps={{
          sandboxPermissions: 'allow-scripts',
          iframeProps: { title: `${tool.name} interface` },
        }}
      />
    </div>
  )
}
