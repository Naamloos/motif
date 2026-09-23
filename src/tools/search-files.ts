import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { searchWorkspaceFiles } from '@/services/workspace-access'

export function searchFiles(context: AgentToolContext) {
  return tool({
    description:
      'Search file names and text in the selected workspace. Returns matching paths, line numbers, and short excerpts; use readFile with line numbers to inspect more context.',
    inputSchema: z.object({
      path: z.string().default('.'),
      query: z.string().trim().min(1).max(300),
      contextLines: z.number().int().min(0).max(5).default(1),
    }),
    execute: ({ path, query, contextLines }) =>
      searchWorkspaceFiles(context, path, query, contextLines),
  })
}
