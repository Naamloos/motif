import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { searchWorkspaceFiles } from '@/services/workspace-access'

export function searchFiles(context: AgentToolContext) {
  return tool({
    description:
      'Search file names and text in this chat’s selected folder. Without a folder, request approval.',
    inputSchema: z.object({
      path: z.string().default('.'),
      query: z.string().trim().min(1).max(300),
    }),
    execute: ({ path, query }) => searchWorkspaceFiles(context, path, query),
  })
}
