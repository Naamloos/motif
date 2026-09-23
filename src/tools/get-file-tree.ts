import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { getWorkspaceTree } from '@/services/workspace-access'

export function getFileTree(context: AgentToolContext) {
  return tool({
    description:
      'Show a bounded recursive file tree for the selected workspace. Build output, dependencies, and Git internals are excluded.',
    inputSchema: z.object({
      path: z.string().default('.'),
      depth: z.number().int().min(1).max(6).default(3),
    }),
    execute: ({ path, depth }) => getWorkspaceTree(context, path, depth),
  })
}
