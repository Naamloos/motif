import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { readWorkspaceFile } from '@/services/workspace-access'

export function readTextFile(context: AgentToolContext) {
  return tool({
    description:
      'Read a text file from the selected workspace. Use startLine and endLine to inspect specific sections; ranged output includes line numbers for precise edits.',
    inputSchema: z.object({
      path: z.string().min(1),
      startLine: z.number().int().min(1).optional(),
      endLine: z.number().int().min(1).optional(),
    }),
    execute: ({ path, startLine, endLine }) =>
      readWorkspaceFile(context, path, startLine, endLine),
  })
}
