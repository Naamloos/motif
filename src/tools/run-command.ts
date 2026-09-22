import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { outputLimit } from '@/services/workspace-access'

const exec = promisify(execFile)

export function runCommand(context: AgentToolContext) {
  return tool({
    description:
      'Run a command with arguments in the selected chat folder. Every command requires approval.',
    inputSchema: z.object({
      command: z.string().min(1).max(200),
      args: z.array(z.string().max(2000)).max(50).default([]),
    }),
    execute: async ({ command, args }) => {
      const approvalText = `${command} ${args.join(' ')}`.trim()
      if (!(await context.requestApproval('Run command', approvalText))) {
        return 'The user denied the command.'
      }

      const { stdout, stderr } = await exec(command, args, {
        cwd: context.folder ?? process.cwd(),
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      })
      return `${stdout}${stderr ? `\n${stderr}` : ''}`.slice(0, outputLimit)
    },
  })
}
