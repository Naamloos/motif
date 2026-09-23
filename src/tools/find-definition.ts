import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { findWorkspaceDefinition } from '@/services/workspace-access'

export function findDefinition(context: AgentToolContext) {
  return tool({
    description:
      'Find common declarations for a function, class, type, or variable name across the selected workspace.',
    inputSchema: z.object({
      path: z.string().default('.'),
      symbol: z.string().trim().min(1).max(200),
    }),
    execute: ({ path, symbol }) => findWorkspaceDefinition(context, path, symbol),
  })
}
