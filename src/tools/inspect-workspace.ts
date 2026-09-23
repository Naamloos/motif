import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { inspectWorkspace } from '@/services/workspace-access'

export function inspectWorkspaceTool(context: AgentToolContext) {
  return tool({
    description:
      'Orient yourself in a workspace: show top-level files, project manifests and scripts, README opening, and local AGENTS.md or CLAUDE.md instructions.',
    inputSchema: z.object({ path: z.string().default('.') }),
    execute: ({ path }) => inspectWorkspace(context, path),
  })
}
