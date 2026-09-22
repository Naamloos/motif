import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'

export function openInBrowser(context: AgentToolContext) {
  return tool({
      description: 'Ask to open a public webpage in the system browser.',
      inputSchema: z.object({ url: z.url() }),
    execute: async ({ url }) => {
      if (!(await context.requestApproval('Open webpage', url.toString()))) {
        return 'The user denied opening the webpage.'
      }
      nw.Shell.openExternal(url.toString())
      return 'Opened in the system browser.'
    },
  })
}
