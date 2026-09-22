import MarkdownIt from 'markdown-it'
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

function ToolDetails({ tool, active }: { tool: ToolTrace; active: boolean }) {
  return (
    <details
      open={active}
      className={`rounded-lg border px-3 py-2 text-sm ${active ? 'streaming-glow' : ''}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <Wrench className="size-4" aria-hidden="true" />
        {tool.name} · {tool.status}
        {active && <LoaderCircle className="ml-auto size-4 animate-spin" aria-label="Running" />}
      </summary>
      <div className="mt-3 space-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Input</p>
          <pre className="whitespace-pre-wrap break-words">{tool.input || '…'}</pre>
        </div>
        {tool.output && (
          <div>
            <p className="text-xs text-muted-foreground">Output</p>
            <pre className="whitespace-pre-wrap break-words">{tool.output}</pre>
          </div>
        )}
      </div>
    </details>
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
      className={`rounded-lg border px-3 py-2 text-sm text-muted-foreground ${active ? 'streaming-glow' : ''}`}
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
      <div className="space-y-3">
        {activityFor(message).map((activity) => {
          const active = message.isStreaming === true && message.activeActivityId === activity.id
          if (activity.type === 'reasoning') {
            return <ReasoningDetails key={activity.id} activity={activity} active={active} />
          }
          const tool = message.tools.find((item) => item.id === activity.toolId)
          return tool ? <ToolDetails key={activity.id} tool={tool} active={active} /> : null
        })}

        {message.text && (
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
        {message.isStreaming &&
          ((!message.text && !message.reasoning) || !message.activeActivityId) && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              Thinking…
            </p>
          )}
      </div>
    </article>
  )
}
