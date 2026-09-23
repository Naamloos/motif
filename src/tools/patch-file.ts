import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { patchWorkspaceFile } from '@/services/workspace-access'

export function patchFile(context: AgentToolContext) {
  return tool({
    description:
      'Replace one unique exact text occurrence in a workspace file. Include enough surrounding lines in search to identify the target; ambiguous matches are rejected.',
    inputSchema: z.object({
      path: z.string().min(1),
      search: z.string().min(1),
      replacement: z.string(),
    }),
    execute: ({ path, search, replacement }) =>
      patchWorkspaceFile(context, path, search, replacement),
  })
}
