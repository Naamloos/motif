import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { findWorkspaceFiles } from '@/services/workspace-access'

export function findFiles(context: AgentToolContext) {
  return tool({
    description:
      'Find workspace files by a case-insensitive filename substring. Searches subfolders and ignores build and dependency folders.',
    inputSchema: z.object({
      path: z.string().default('.'),
      query: z.string().trim().min(1).max(300),
    }),
    execute: ({ path, query }) => findWorkspaceFiles(context, path, query),
  })
}
