import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'

export function manageTasks(context: AgentToolContext) {
  return tool({
    description:
      'Add a task to this chat checklist or mark one complete. Use list to inspect current tasks.',
    inputSchema: z.object({
      action: z.enum(['add', 'complete', 'list']),
      task: z.string().optional(),
      taskId: z.string().optional(),
    }),
    execute: async ({ action, task, taskId }) => {
      if (action === 'list') return context.getTasks(context.chatId)
      if (action === 'add') return context.addTask(context.chatId, task ?? '')
      return context.completeTask(context.chatId, taskId ?? '')
    },
  })
}
