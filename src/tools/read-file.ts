import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { readWorkspaceFile } from '@/services/workspace-access'

export function readTextFile(context: AgentToolContext) {
  return tool({
    description:
      'Read a text file in this chat’s selected folder. Without a folder, request approval.',
    inputSchema: z.object({ path: z.string().min(1) }),
    execute: ({ path }) => readWorkspaceFile(context, path),
  })
}
