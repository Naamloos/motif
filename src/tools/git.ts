import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { outputLimit } from '@/services/workspace-access'

const exec = promisify(execFile)

function runGit(context: AgentToolContext, args: string[]) {
  return exec('git', ['--no-pager', ...args], {
    cwd: context.folder ?? process.cwd(),
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    signal: context.abortSignal,
  })
}

export function git(context: AgentToolContext) {
  return tool({
    description:
      'Inspect Git status, diffs, commits, and branches; stage or unstage paths, create or switch branches, and commit staged changes. Actions follow the command approval setting.',
    inputSchema: z.object({
      action: z.enum([
        'status',
        'diff',
        'log',
        'branches',
        'show',
        'stage',
        'unstage',
        'commit',
        'createBranch',
        'switchBranch',
      ]),
      paths: z.array(z.string().min(1).max(500)).max(50).optional(),
      message: z.string().max(500).optional(),
      branch: z.string().max(200).optional(),
    }),
    execute: async ({ action, paths, message, branch }) => {
      const details = paths?.join('\n') ?? message ?? branch ?? context.folder ?? process.cwd()
      if (
        context.requireApprovalForCommands &&
        !(await context.requestApproval(`Git ${action}`, details))
      ) {
        return 'The user denied this Git operation.'
      }

      if (action === 'diff') {
        const [working, staged] = await Promise.all([
          runGit(context, ['diff', '--no-ext-diff', '--']),
          runGit(context, ['diff', '--cached', '--no-ext-diff', '--']),
        ])
        return [staged.stdout, working.stdout].filter(Boolean).join('\n').slice(0, outputLimit) || 'No file changes.'
      }

      let args: string[] = []
      switch (action) {
        case 'status':
          args = ['status', '--short', '--branch']
          break
        case 'log':
          args = ['log', '-10', '--oneline', '--decorate']
          break
        case 'branches':
          args = ['branch', '--list']
          break
        case 'show':
          args = ['show', '--stat', '--oneline', '-1']
          break
        case 'stage':
        case 'unstage': {
          if (!paths?.length) {
            throw new Error(`${action} requires at least one workspace-relative path.`)
          }
          for (const path of paths) {
            if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) {
              throw new Error('Git paths must stay inside the selected workspace.')
            }
          }
          args =
            action === 'stage'
              ? ['add', '--', ...paths]
              : ['restore', '--staged', '--', ...paths]
          break
        }
        case 'commit':
          if (!message?.trim()) throw new Error('commit requires a non-empty message.')
          args = ['commit', '-m', message]
          break
        case 'createBranch':
        case 'switchBranch':
          if (
            !branch ||
            !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch) ||
            branch.includes('..')
          ) {
            throw new Error('Use a valid branch name starting with a letter or number.')
          }
          args = action === 'createBranch' ? ['switch', '-c', branch] : ['switch', branch]
          break
      }

      const { stdout, stderr } = await runGit(context, args)
      const output = `${stdout}${stderr ? `\n${stderr}` : ''}`.slice(0, outputLimit)
      return output || `Git ${action} completed.`
    },
  })
}
