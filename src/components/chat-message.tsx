import MarkdownIt from 'markdown-it'
import type { ReactElement } from 'react'
import { McpUiView } from '@/components/mcp-ui-view'
import {
  ChevronDown,
  Clock3,
  Gauge,
  Hash,
  LoaderCircle,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AssistantActivity, ChatMessage, ToolTrace } from '@/stores/app-model'

const markdown = new MarkdownIt({ html: false, breaks: true })
const thinkingTexts = [
  'Thinking...',
  'Yapping...',
  'Thunking...',
  'Gooning...',
  'I uh I uh idk 1 sec...',
  "Hol up...",
  "Tokening...",
  "Pondering...",
  "That's a good question...",
  "Fuck, hang on...",
  "Uhhhhhh...",
  "Wasting GPU cycles...",
  "Dumb question, but let me think...",
  "Drinking a shit ton of water...",
  "Hallucinating bullshit...",
  "In a fight with Claude...",
  "Is this thing on?...",
  "Wasting tokens...",
  "Crying about RAM prices...",
  "Being a senior engineer and making no mistakes...",
  "Awaiting payment...",
  "I'll look at it tomorrow...",
  "Routing your request to India...",
  "sudo rm -rf / --no-preserve-root..."
]

markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index]
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, index, options)
}

function ResponseMetric({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon
  value: string
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} className="inline-flex cursor-help items-center gap-1.5" />}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        <span>{value}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function DiffViewer({ diff }: { diff: string }) {
  const { elements: lines } = diff.split('\n').reduce(
    (state, line, index) => {
      let { oldLine, newLine } = state
      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (hunk) {
        oldLine = Number(hunk[1])
        newLine = Number(hunk[2])
      }

      const removed = line.startsWith('-') && !line.startsWith('--- ')
      const added = line.startsWith('+') && !line.startsWith('+++ ')
      const context = line.startsWith(' ')
      const oldNumber = removed || context ? oldLine : ''
      const newNumber = added || context ? newLine : ''
      if (removed || context) oldLine += 1
      if (added || context) newLine += 1
      const color = added
        ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
        : removed
          ? 'bg-red-500/10 text-red-800 dark:text-red-300'
          : line.startsWith('@@')
            ? 'bg-blue-500/10 text-blue-800 dark:text-blue-300'
            : ''

      return {
        oldLine,
        newLine,
        elements: [
          ...state.elements,
          <div key={index} className={`grid grid-cols-[3rem_3rem_1fr] ${color}`}>
            <span className="select-none px-2 text-right text-muted-foreground">{oldNumber}</span>
            <span className="select-none px-2 text-right text-muted-foreground">{newNumber}</span>
            <span className="whitespace-pre px-2">{line || ' '}</span>
          </div>,
        ],
      }
    },
    { oldLine: 0, newLine: 0, elements: [] as ReactElement[] },
  )

  return (
    <div
      role="region"
      aria-label="File diff"
      tabIndex={0}
      className="max-h-96 overflow-auto rounded-md border bg-background py-1 font-mono text-xs"
    >
      {lines}
    </div>
  )
}

function isDiffOutput(output: string) {
  return output.startsWith('diff --git ') || /^--- a\/[^\n]*\n\+\+\+ b\//.test(output)
}

function ToolDetails({ tool, active }: { tool: ToolTrace; active: boolean }) {
  const app =
    tool.app ??
    (() => {
      try {
        const output = JSON.parse(tool.output ?? '') as {
          content?: Array<{ type?: string; resource?: ToolTrace['app'] & { text?: string } }>
        }
        const resource = output.content?.find((item) => item.type === 'resource')?.resource
        return resource?.uri?.startsWith('ui://') &&
          resource.mimeType &&
          typeof resource.text === 'string'
          ? { uri: resource.uri, mimeType: resource.mimeType, html: resource.text }
          : undefined
      } catch {
        return undefined
      }
    })()
  return (
    <div className="min-w-0 max-w-full space-y-2">
      <details
        open={active}
        className={`min-w-0 max-w-full overflow-hidden rounded-lg border px-3 py-2 text-sm ${active ? 'streaming-glow' : ''}`}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2">
          <Wrench className="size-4" aria-hidden="true" />
          {tool.name} - {tool.status}
          {active && <LoaderCircle className="ml-auto size-4 animate-spin" aria-label="Running" />}
        </summary>
        <div className="mt-3 space-y-2">
          <div>
            <p className="text-xs text-muted-foreground">Input</p>
            <pre className="max-w-full whitespace-pre-wrap break-all">{tool.input || '...'}</pre>
          </div>
          {tool.output && !app && (
            <div>
              <p className="text-xs text-muted-foreground">Output</p>
              {isDiffOutput(tool.output) ? (
                <DiffViewer diff={tool.output} />
              ) : (
                <pre className="max-w-full whitespace-pre-wrap break-all">{tool.output}</pre>
              )}
            </div>
          )}
        </div>
      </details>
      {app && <McpUiView app={app} tool={tool} />}
    </div>
  )
}

function ReasoningDetails({
  activity,
  active,
}: {
  activity: Extract<AssistantActivity, { type: 'reasoning' }>
  active: boolean
}) {
  // eslint-disable-next-line react-hooks/purity
  const elapsed = activity.durationMs ?? (activity.startedAt ? Date.now() - activity.startedAt : 0)

  return (
    <details
      className={`min-w-0 max-w-full overflow-hidden rounded-lg border px-3 py-2 text-sm text-muted-foreground ${active ? 'streaming-glow' : ''}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <ChevronDown className="size-4" aria-hidden="true" />
        Reasoning
        {active && <LoaderCircle className="size-4 animate-spin" aria-label="Reasoning" />}
      </summary>
      <div
        className="markdown-content mt-2"
        dangerouslySetInnerHTML={{ __html: markdown.render(activity.text) }}
      />
      {(activity.startedAt || activity.durationMs !== undefined) && (
        <p className="mt-2 text-[10px] text-muted-foreground">{(elapsed / 1000).toFixed(1)}s</p>
      )}
    </details>
  )
}

function activityFor(message: ChatMessage): AssistantActivity[] {
  if (message.activity.length) return message.activity
  return [
    ...(message.reasoning
      ? [{ id: 'legacy-reasoning', type: 'reasoning' as const, text: message.reasoning }]
      : []),
    ...message.tools.map((tool) => ({
      id: `legacy-${tool.id}`,
      type: 'tool' as const,
      toolId: tool.id,
    })),
  ]
}

export function ChatMessageView({ message }: { message: ChatMessage }) {
  const thinkingText =
    thinkingTexts[
      Array.from(message.id).reduce(
        (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
        0,
      ) % thinkingTexts.length
    ]
  if (message.role === 'user') {
    return (
      <article className="chat-message space-y-2">
        <div className="markdown-content ml-auto w-fit max-w-[85%] space-y-2 rounded-2xl bg-primary px-4 py-2 text-primary-foreground">
          {message.text && (
            <div dangerouslySetInnerHTML={{ __html: markdown.render(message.text) }} />
          )}
          {message.images?.map((image) => (
            <img
              key={image.id}
              src={`data:${image.mediaType};base64,${image.data}`}
              alt={image.name}
              className="max-h-72 max-w-full rounded-lg object-contain"
            />
          ))}
        </div>
      </article>
    )
  }

  return (
    <article className="chat-message space-y-2">
      <div className="min-w-0 max-w-full space-y-3">
        {activityFor(message).map((activity) => {
          const active = message.isStreaming === true && message.activeActivityId === activity.id
          if (activity.type === 'reasoning') {
            return <ReasoningDetails key={activity.id} activity={activity} active={active} />
          }
          if (activity.type === 'text') {
            return (
              <div
                key={activity.id}
                className="markdown-content w-fit max-w-[85%] rounded-2xl bg-muted px-4 py-2"
                dangerouslySetInnerHTML={{ __html: markdown.render(activity.text) }}
              />
            )
          }
          const tool = message.tools.find((item) => item.id === activity.toolId)
          return tool ? <ToolDetails key={activity.id} tool={tool} active={active} /> : null
        })}

        {message.text && !message.activity.some((activity) => activity.type === 'text') && (
          <div
            className="markdown-content w-fit max-w-[85%] rounded-2xl bg-muted px-4 py-2"
            dangerouslySetInnerHTML={{ __html: markdown.render(message.text) }}
          />
        )}

        {!message.isStreaming && message.durationMs !== undefined && (
          <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-muted-foreground">
            <ResponseMetric
              icon={Clock3}
              value={`${(message.durationMs / 1000).toFixed(1)}s`}
              label="Time spent generating this response"
            />
            {message.tokensPerSecond !== undefined && (
              <ResponseMetric
                icon={Gauge}
                value={`${message.tokensPerSecond.toFixed(1)} tokens/s`}
                label="Output tokens generated per second"
              />
            )}
            {message.outputTokens !== undefined && (
              <ResponseMetric
                icon={Hash}
                value={`${message.outputTokens.toLocaleString()} output tokens`}
                label="Total output tokens in this response"
              />
            )}
          </div>
        )}

        {message.error && <p className="text-sm text-destructive">{message.error}</p>}
        {message.runSnapshot && (
          <details className="w-fit px-1 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Run settings - {message.runSnapshot.model}</summary>
            <div className="mt-1 space-y-0.5">
              <p>Provider: {message.runSnapshot.provider}</p>
              <p>Reasoning: {message.runSnapshot.reasoningEffort}</p>
              <p>Tool steps: {message.runSnapshot.maxToolSteps}</p>
              <p>Context limit: {message.runSnapshot.contextTurns} turns</p>
              <p>Tools enabled: {message.runSnapshot.enabledTools.join(', ') || 'None'}</p>
              <p>Workspace: {message.runSnapshot.workspaceFolder || 'None'}</p>
              <p>
                File change approvals: {message.runSnapshot.approvalForFileChanges ? 'On' : 'Off'}
              </p>
              <p>MCP approvals: {message.runSnapshot.approvalForMcpTools ? 'On' : 'Off'}</p>
              <p>Command approvals: {message.runSnapshot.approvalForCommands ? 'On' : 'Off'}</p>
              <p>Browser approvals: {message.runSnapshot.approvalForBrowser ? 'On' : 'Off'}</p>
              {message.runSnapshot.memories.length > 0 && (
                <p>Memories: {message.runSnapshot.memories.join(' - ')}</p>
              )}
              {message.runSnapshot.systemPrompt && (
                <p className="max-w-lg whitespace-pre-wrap">
                  Instructions: {message.runSnapshot.systemPrompt}
                </p>
              )}
            </div>
          </details>
        )}
        {message.isStreaming &&
          ((!message.text && !message.reasoning) || !message.activeActivityId) && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              {thinkingText}
            </p>
          )}
      </div>
    </article>
  )
}
