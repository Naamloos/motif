import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'

export function searchChats(context: AgentToolContext) {
  return tool({
    description: 'Search previous chats for matching message text.',
    inputSchema: z.object({ query: z.string().trim().min(1).max(300) }),
    execute: async ({ query }) =>
      context
        .getChats()
        .flatMap((chat) =>
          chat.messages.flatMap((message) =>
            message.text.toLowerCase().includes(query.toLowerCase())
              ? [{ chat: chat.title, role: message.role, excerpt: message.text.slice(0, 500) }]
              : [],
          ),
        )
        .slice(0, 20),
  })
}
