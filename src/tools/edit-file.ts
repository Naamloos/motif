import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { editWorkspaceLines } from '@/services/workspace-access'

export function editFile(context: AgentToolContext) {
  return tool({
    description:
      'Replace an inclusive one-based line range in a workspace file. Set expectedText to the exact line contents without the line-number prefix shown by readFile; the edit is rejected if those lines changed.',
    inputSchema: z
      .object({
        path: z.string().min(1),
        startLine: z.number().int().min(1),
        endLine: z.number().int().min(1),
        expectedText: z.string().min(1).max(20_000),
        replacement: z.string().max(100_000),
      })
      .refine(({ startLine, endLine }) => endLine >= startLine, {
        message: 'endLine must be greater than or equal to startLine.',
      }),
    execute: ({ path, startLine, endLine, expectedText, replacement }) =>
      editWorkspaceLines(context, path, startLine, endLine, expectedText, replacement),
  })
}
