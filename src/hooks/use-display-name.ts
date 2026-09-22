import { useEffect, useState } from 'react'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const username = os.userInfo().username

let displayNamePromise: Promise<string> | undefined

async function resolveDisplayName(): Promise<string> {
  try {
    switch (process.platform) {
      case 'win32': {
        const script = `
          $user = [ADSI]"WinNT://$env:USERDOMAIN/$env:USERNAME,user"
          $user.FullName
        `

        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          script,
        ])

        return stdout.trim() || username
      }

      case 'darwin': {
        const { stdout } = await execFileAsync('id', ['-F'])

        return stdout.trim() || username
      }

      case 'linux': {
        const { stdout } = await execFileAsync('getent', ['passwd', username])

        const gecos = stdout.split(':')[4] ?? ''
        const displayName = gecos.split(',')[0]?.trim()

        return displayName || username
      }

      default:
        return username
    }
  } catch {
    return username
  }
}

function getDisplayName(): Promise<string> {
  displayNamePromise ??= resolveDisplayName()

  return displayNamePromise
}

export function useDisplayName(): string {
  const [displayName, setDisplayName] = useState(username)

  useEffect(() => {
    let mounted = true

    getDisplayName().then((name) => {
      if (mounted) {
        setDisplayName(name)
      }
    })

    return () => {
      mounted = false
    }
  }, [])

  return displayName
}
