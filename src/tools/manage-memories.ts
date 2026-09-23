import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'

export function manageMemories(context: AgentToolContext) {
  return tool({
    description: 'Review saved memories or ask the user to approve removing one.',
    inputSchema: z.object({
      action: z.enum(['list', 'remove', 'edit']),
      memory: z.string().trim().min(1).max(1000).optional(),
      replacement: z.string().trim().min(1).max(1000).optional(),
    }),
    execute: async ({ action, memory, replacement }) => {
      if (action === 'list') return context.listMemories().join('\n') || 'No memories are saved.'
      if (!memory) return 'Provide the exact memory to update or remove.'
      if (action === 'remove') {
        if (!(await context.requestApproval('Remove memory', memory)))
          return 'The user declined to remove this memory.'
        return context.removeMemory(memory) ? 'Memory removed.' : 'That memory was not found.'
      }
      if (!replacement) return 'Provide the replacement memory.'
      if (!(await context.requestApproval('Edit memory', `${memory}\n→ ${replacement}`)))
        return 'The user declined to edit this memory.'
      return context.updateMemory(memory, replacement) ? 'Memory updated.' : 'That memory was not found.'
    },
  })
}
