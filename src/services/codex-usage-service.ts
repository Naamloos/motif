import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'

export type CodexRateLimitWindow = {
  usedPercent: number
  windowDurationMins?: number | null
  resetsAt?: number | null
}

export type CodexUsageLimits = {
  planType?: string | null
  primary?: CodexRateLimitWindow | null
  secondary?: CodexRateLimitWindow | null
}

export function readCodexUsageLimits(): Promise<CodexUsageLimits> {
  const cliPath = join(dirname(nw.require.resolve('@openai/codex/package.json')), 'bin', 'codex.js')
  const child = spawn('node', [cliPath, 'app-server'], { stdio: ['pipe', 'pipe', 'pipe'] })
  const lines = createInterface({ input: child.stdout })

  return new Promise((resolve, reject) => {
    let stderr = ''
    let settled = false
    const finish = (error?: Error, value?: CodexUsageLimits) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      lines.close()
      child.kill()
      if (error) reject(error)
      else resolve(value!)
    }
    const timeout = setTimeout(() => finish(new Error('Codex usage request timed out.')), 15_000)

    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4_000)
    })
    child.once('error', (error) => finish(error))
    child.once('close', (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Codex app-server exited (${code}).`))
    })
    lines.on('line', (line) => {
      let message: Record<string, unknown>
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (message.id === 1) {
        if (message.error) {
          finish(new Error(JSON.stringify(message.error)))
          return
        }
        child.stdin.write('{"method":"initialized"}\n')
        child.stdin.write(
          `${JSON.stringify({ id: 2, method: 'account/rateLimits/read', params: null })}\n`,
        )
      } else if (message.id === 2) {
        if (message.error) finish(new Error(JSON.stringify(message.error)))
        else {
          const response = (message.result ?? {}) as {
            rateLimits?: CodexUsageLimits
            rateLimitsByLimitId?: Record<string, CodexUsageLimits> | null
          }
          finish(undefined, response.rateLimitsByLimitId?.codex ?? response.rateLimits ?? {})
        }
      }
    })

    child.stdin.write(
      `${JSON.stringify({
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'Motif', version: '1.0.0' },
          capabilities: { experimentalApi: true, optOutNotificationMethods: null },
        },
      })}\n`,
    )
  })
}
