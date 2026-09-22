import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { patchWorkspaceFile } from '@/services/workspace-access'

export function patchFile(context: AgentToolContext) {
  return tool({
    description:
      'Replace an exact text occurrence in a file in this chat’s selected folder. Without a folder, request approval.',
    inputSchema: z.object({
      path: z.string().min(1),
      search: z.string().min(1),
      replacement: z.string(),
    }),
    execute: ({ path, search, replacement }) =>
      patchWorkspaceFile(context, path, search, replacement),
  })
}
