import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'

export function saveMemory(context: AgentToolContext) {
  return tool({
    description: 'Ask the user to approve saving a preference or fact for future chats.',
    inputSchema: z.object({ memory: z.string().trim().min(1).max(1000) }),
    execute: async ({ memory }) => {
      if (!(await context.requestApproval('Save memory', memory))) {
        return 'The user declined to save this memory.'
      }
      context.saveMemory(memory)
      return 'Saved for future chats.'
    },
  })
}
