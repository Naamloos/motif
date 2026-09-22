import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { AgentToolContext } from '@/services/agent-tool-context'

export const outputLimit = 16_000
const fileSizeLimit = 1_000_000
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build'])

function inside(root: string, path: string) {
  const fromRoot = relative(root, path)
  return (
    fromRoot === '' ||
    (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  )
}

export async function resolveWorkspacePath(folder: string | undefined, input: string) {
  const root = folder ? await realpath(folder) : undefined
  const path = resolve(root ?? process.cwd(), input)
  if (root && !inside(root, path)) {
    throw new Error('That path is outside this chat’s selected folder.')
  }

  // Check the nearest existing ancestor so symlinks cannot escape the selected folder.
  let existing = path
  while (true) {
    try {
      const actual = await realpath(existing)
      if (root && !inside(root, actual)) {
        throw new Error('That path resolves outside this chat’s selected folder.')
      }
      break
    } catch (error) {
      if (error instanceof Error && error.message.includes('outside this chat')) throw error
      const parent = dirname(existing)
      if (parent === existing) break
      existing = parent
    }
  }

  return { path, root }
}

export async function approvePath(context: AgentToolContext, action: string, path: string) {
  return Boolean(context.folder) || context.requestApproval(action, `Allow access to ${path}?`)
}

async function authorizedPath(context: AgentToolContext, action: string, input: string) {
  const result = await resolveWorkspacePath(context.folder, input)
  if (!(await approvePath(context, action, result.path))) return null
  return result
}

export async function listWorkspaceFiles(context: AgentToolContext, input: string) {
  const target = await authorizedPath(context, 'list files', input)
  if (!target) return 'The user denied filesystem access.'
  const entries = await readdir(target.path, { withFileTypes: true })
  return entries
    .slice(0, 200)
    .map((entry) => `${entry.isDirectory() ? 'directory' : 'file'} ${entry.name}`)
}

async function walkFiles(root: string, maxFiles = 500) {
  const files: string[] = []
  const pending = [root]

  while (pending.length && files.length < maxFiles) {
    const directory = pending.pop()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) pending.push(path)
      else if (entry.isFile()) files.push(path)
      if (files.length >= maxFiles) break
    }
  }

  return files
}

export async function searchWorkspaceFiles(
  context: AgentToolContext,
  input: string,
  query: string,
) {
  const target = await authorizedPath(context, 'search files', input)
  if (!target) return 'The user denied filesystem access.'
  const matches: string[] = []

  for (const file of await walkFiles(target.path)) {
    if (!inside(target.path, file)) continue
    if (file.toLowerCase().includes(query.toLowerCase())) {
      matches.push(relative(target.root ?? target.path, file))
    }
    try {
      const stat = await lstat(file)
      if (stat.size <= fileSizeLimit) {
        const text = await readFile(file, 'utf8')
        if (!text.includes('\0') && text.toLowerCase().includes(query.toLowerCase())) {
          const line =
            text
              .split(/\r?\n/)
              .findIndex((value) => value.toLowerCase().includes(query.toLowerCase())) + 1
          matches.push(`${relative(target.root ?? target.path, file)}:${line}`)
        }
      }
    } catch {
      // Skip unreadable and binary files; a search should still return other matches.
    }
    if (matches.length >= 50) break
  }

  return matches
}

export async function readWorkspaceFile(context: AgentToolContext, input: string) {
  const target = await authorizedPath(context, 'read files', input)
  if (!target) return 'The user denied filesystem access.'
  if ((await lstat(target.path)).size > fileSizeLimit) {
    throw new Error('This file is larger than the 1 MB read limit.')
  }
  const text = await readFile(target.path, 'utf8')
  if (text.includes('\0')) throw new Error('This tool reads text files only.')
  return text.slice(0, outputLimit)
}

export async function writeWorkspaceFile(
  context: AgentToolContext,
  input: string,
  content: string,
) {
  const target = await authorizedPath(context, 'write files', input)
  if (!target) return 'The user denied filesystem access.'
  await mkdir(dirname(target.path), { recursive: true })
  await writeFile(target.path, content, 'utf8')
  return `Wrote ${target.path}`
}

export async function patchWorkspaceFile(
  context: AgentToolContext,
  input: string,
  search: string,
  replacement: string,
) {
  const target = await authorizedPath(context, 'replace files', input)
  if (!target) return 'The user denied filesystem access.'
  if ((await lstat(target.path)).size > fileSizeLimit) {
    throw new Error('This file is larger than the 1 MB patch limit.')
  }
  const previous = await readFile(target.path, 'utf8')
  if (!previous.includes(search)) throw new Error('The exact text was not found in the file.')
  await writeFile(target.path, previous.replace(search, replacement), 'utf8')
  return `Updated ${target.path}`
}
