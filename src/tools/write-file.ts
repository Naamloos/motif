import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { writeWorkspaceFile } from '@/services/workspace-access'

export function writeTextFile(context: AgentToolContext) {
  return tool({
    description:
      'Write a text file in this chat’s selected folder. Without a folder, request approval.',
    inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
    execute: ({ path, content }) => writeWorkspaceFile(context, path, content),
  })
}
