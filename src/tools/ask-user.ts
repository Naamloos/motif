import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'

export function askUser(context: AgentToolContext) {
  return tool({
    description: 'Ask the user a question and wait for their response.',
    inputSchema: z.object({ question: z.string().trim().min(1).max(1000) }),
    execute: async ({ question }) =>
      (await context.askUser(question)) ?? 'The user dismissed the question.',
  })
}
