import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { listWorkspaceFiles } from '@/services/workspace-access'

export function listFiles(context: AgentToolContext) {
  return tool({
    description: 'List files in this chat’s selected folder. Without a folder, request approval.',
    inputSchema: z.object({ path: z.string().default('.') }),
    execute: ({ path }) => listWorkspaceFiles(context, path),
  })
}
