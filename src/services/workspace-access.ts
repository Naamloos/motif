import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { AgentToolContext } from '@/services/agent-tool-context'

export const outputLimit = 16_000
const fileSizeLimit = 1_000_000
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'release',
  '.next',
  '.vite',
  '.turbo',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function fileDiff(path: string, before: string, after: string) {
  const oldLines = before.split(/\r?\n/)
  const newLines = after.split(/\r?\n/)
  if (oldLines.at(-1) === '') oldLines.pop()
  if (newLines.at(-1) === '') newLines.pop()

  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++
  }

  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  if (start === oldEnd && start === newEnd) return ''

  const contextStart = Math.max(0, start - 2)
  const contextEnd = Math.min(oldLines.length, oldEnd + 2)
  const oldCount = contextEnd - contextStart
  const newCount = contextEnd - contextStart + (newEnd - start) - (oldEnd - start)
  const oldStart = oldCount === 0 ? contextStart : contextStart + 1
  const newStart = newCount === 0 ? contextStart : contextStart + 1
  const safePath = path.replace(/[\r\n]/g, '')
  const lines = [
    `--- a/${safePath}`,
    `+++ b/${safePath}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...oldLines.slice(contextStart, start).map((line) => ` ${line}`),
    ...oldLines.slice(start, oldEnd).map((line) => `-${line}`),
    ...newLines.slice(start, newEnd).map((line) => `+${line}`),
    ...oldLines.slice(oldEnd, contextEnd).map((line) => ` ${line}`),
  ]
  const diff = lines.join('\n')
  return diff.length > outputLimit ? `${diff.slice(0, outputLimit)}\n... diff truncated` : diff
}

async function replaceFile(path: string, content: string) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

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
  if (action === 'write files' || action === 'replace files') {
    if (!context.requireApprovalForFileChanges && context.folder) return true
  } else if (context.folder) return true
  return context.requestApproval(action, `Allow access to ${path}?`)
}

async function authorizedPath(context: AgentToolContext, action: string, input: string) {
  const result = await resolveWorkspacePath(context.folder, input)
  if (!(await approvePath(context, action, result.path))) return null
  return result
}

export async function listWorkspaceFiles(context: AgentToolContext, input: string) {
  const target = await authorizedPath(context, 'list files', input)
  if (!target) return 'The user denied filesystem access.'
  const entries = (await readdir(target.path, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  const results = entries
    .slice(0, 200)
    .map((entry) => `${entry.isDirectory() ? 'directory' : 'file'} ${entry.name}`)
  if (entries.length > results.length) {
    results.push(`Showing ${results.length} of ${entries.length} entries.`)
  }
  const output = results.join('\n')
  return output.length > outputLimit ? `${output.slice(0, outputLimit)}\n... results truncated` : output
}

export async function getWorkspaceTree(
  context: AgentToolContext,
  input: string,
  maxDepth: number,
) {
  const target = await authorizedPath(context, 'list files', input)
  if (!target) return 'The user denied filesystem access.'
  const workspaceRoot = target.path
  const entries: string[] = []

  async function visit(directory: string, depth: number): Promise<boolean> {
    if (depth > maxDepth) return false
    const children = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const child of children) {
      if (child.isDirectory() && ignoredDirectories.has(child.name)) continue
      const relativePath = relative(workspaceRoot, resolve(directory, child.name))
      entries.push(
        `${'  '.repeat(depth)}${child.isDirectory() ? 'directory' : 'file'} ${relativePath}`,
      )
      if (entries.length >= 300) return true
      if (
        child.isDirectory() &&
        depth < maxDepth &&
        (await visit(resolve(directory, child.name), depth + 1))
      ) {
        return true
      }
    }
    return false
  }

  const truncated = await visit(workspaceRoot, 0)
  if (truncated) entries.push('Tree limit reached; some entries are omitted.')
  const output = entries.join('\n') || 'The selected folder is empty.'
  return output.length > outputLimit
    ? `${output.slice(0, outputLimit)}\n... tree truncated`
    : output
}

export async function inspectWorkspace(context: AgentToolContext, input: string) {
  const target = await authorizedPath(context, 'inspect workspace', input)
  if (!target) return 'The user denied filesystem access.'
  const entries = (await readdir(target.path, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  const sections = [
    `Workspace: ${target.path}`,
    `Top-level entries:\n${entries
      .slice(0, 100)
      .map((entry) => `${entry.isDirectory() ? 'directory' : 'file'} ${entry.name}`)
      .join('\n')}`,
  ]
  const knownFiles = new Set([
    'AGENTS.md',
    'CLAUDE.md',
    'README.md',
    'package.json',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'Makefile',
    'justfile',
  ])

  for (const entry of entries) {
    if (!entry.isFile() || !knownFiles.has(entry.name)) continue
    const path = resolve(target.path, entry.name)
    if ((await stat(path)).size > 20_000) continue
    const content = await readFile(path, 'utf8')
    if (entry.name === 'package.json') {
      try {
        const manifest: unknown = JSON.parse(content)
        if (isRecord(manifest)) {
          const scripts = isRecord(manifest.scripts) ? manifest.scripts : {}
          sections.push(
            `package.json scripts:\n${Object.entries(scripts)
              .map(([name, command]) => `  ${name}: ${String(command)}`)
              .join('\n') || '  none'}`,
          )
        }
      } catch {
        sections.push('package.json could not be parsed.')
      }
    } else if (entry.name === 'AGENTS.md' || entry.name === 'CLAUDE.md') {
      sections.push(`${entry.name}:\n${content}`)
    } else if (entry.name === 'README.md') {
      sections.push(`README.md (opening section):\n${content.slice(0, 4_000)}`)
    } else {
      sections.push(`${entry.name}:\n${content.slice(0, 2_000)}`)
    }
  }

  const output = sections.join('\n\n')
  return output.length > outputLimit ? `${output.slice(0, outputLimit)}\n... overview truncated` : output
}

export async function findWorkspaceFiles(
  context: AgentToolContext,
  input: string,
  query: string,
) {
  const target = await authorizedPath(context, 'find files', input)
  if (!target) return 'The user denied filesystem access.'
  const needle = query.toLowerCase()
  const searchedFiles = await walkFiles(target.path)
  const files = searchedFiles
    .filter((file) => inside(target.path, file) && file.toLowerCase().includes(needle))
    .map((file) => relative(target.root ?? target.path, file))
  const results = files.slice(0, 100)
  if (files.length > results.length) {
    results.push(`Showing ${results.length} of ${files.length} matches.`)
  }
  if (searchedFiles.length === 500) {
    results.push('Search limit reached; additional workspace files may be omitted.')
  }
  const output = results.join('\n') || 'No matching files found.'
  return output.length > outputLimit ? `${output.slice(0, outputLimit)}\n... results truncated` : output
}

async function walkFiles(root: string, maxFiles = 500) {
  const files: string[] = []
  const pending = [root]

  while (pending.length && files.length < maxFiles) {
    const directory = pending.pop()!
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const entry of entries) {
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
  contextLines = 1,
) {
  const target = await authorizedPath(context, 'search files', input)
  if (!target) return 'The user denied filesystem access.'
  const matches: string[] = []
  const normalizedQuery = query.toLowerCase()
  const files = await walkFiles(target.path)
  let hitCount = 0

  for (const file of files) {
    if (!inside(target.path, file)) continue
    const relativePath = relative(target.root ?? target.path, file)
    if (file.toLowerCase().includes(normalizedQuery)) {
      matches.push(`File name: ${relativePath}`)
    }
    try {
      const fileStat = await stat(file)
      if (fileStat.size <= fileSizeLimit) {
        const text = await readFile(file, 'utf8')
        if (!text.includes('\0')) {
          const lines = text.split(/\r?\n/)
          for (const [index, line] of lines.entries()) {
            if (!line.toLowerCase().includes(normalizedQuery)) continue
            const first = Math.max(0, index - contextLines)
            const last = Math.min(lines.length, index + contextLines + 1)
            matches.push(
              ...lines.slice(first, last).map(
                (value, offset) =>
                  `${relativePath}:${first + offset + 1}: ${value.slice(0, 240)}`,
              ),
            )
            hitCount++
            if (hitCount >= 50) break
          }
        }
      }
    } catch {
      // Skip unreadable and binary files; a search should still return other matches.
    }
    if (hitCount >= 50) break
  }

  const output = matches.join('\n') || 'No matching file names or text found.'
  const notes = [
    hitCount >= 50 ? 'Result limit reached; more matches may exist.' : '',
    files.length === 500
      ? 'Search limit reached; additional workspace files may be omitted.'
      : '',
  ].filter(Boolean)
  const boundedOutput =
    output.length > outputLimit ? `${output.slice(0, outputLimit)}\n... results truncated` : output
  return notes.length ? `${boundedOutput}\n${notes.join('\n')}` : boundedOutput
}

export async function findWorkspaceDefinition(
  context: AgentToolContext,
  input: string,
  symbol: string,
) {
  const target = await authorizedPath(context, 'search files', input)
  if (!target) return 'The user denied filesystem access.'
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const declaration = new RegExp(
    `\\b(?:async\\s+def|function|class|interface|type|enum|const|let|var|def|fn|struct|trait|func)\\s+${escaped}\\b`,
  )
  const results: string[] = []

  for (const file of await walkFiles(target.path)) {
    if (!inside(target.path, file)) continue
    try {
      if ((await stat(file)).size > fileSizeLimit) continue
      const text = await readFile(file, 'utf8')
      if (text.includes('\0')) continue
      const relativePath = relative(target.root ?? target.path, file)
      for (const [index, line] of text.split(/\r?\n/).entries()) {
        if (!declaration.test(line)) continue
        results.push(`${relativePath}:${index + 1}: ${line.trim().slice(0, 240)}`)
        if (results.length >= 50) break
      }
    } catch {
      // Skip files that cannot be read; one inaccessible file should not stop the search.
    }
    if (results.length >= 50) break
  }

  return results.join('\n') || `No common declaration for “${symbol}” found.`
}

export async function readWorkspaceFile(
  context: AgentToolContext,
  input: string,
  startLine?: number,
  endLine?: number,
) {
  const target = await authorizedPath(context, 'read files', input)
  if (!target) return 'The user denied filesystem access.'
  if ((await stat(target.path)).size > fileSizeLimit) {
    throw new Error('This file is larger than the 1 MB read limit.')
  }
  const text = await readFile(target.path, 'utf8')
  if (text.includes('\0')) throw new Error('This tool reads text files only.')
  const lines = text.split(/\r?\n/)
  if (startLine !== undefined || endLine !== undefined) {
    const first = startLine ?? 1
    const last = endLine ?? first + 199
    if (last < first) throw new Error('endLine must be greater than or equal to startLine.')
    if (last - first >= 500) throw new Error('Read at most 500 lines at a time.')
    const selected = lines.slice(first - 1, last)
    if (!selected.length) return `No lines in that range; the file has ${lines.length} lines.`
    const output = `${selected
      .map((line, index) => `${first + index} | ${line}`)
      .join('\n')}\n[Lines ${first}-${Math.min(last, lines.length)} of ${lines.length}]`
    return output.length > outputLimit ? `${output.slice(0, outputLimit)}\n... range truncated` : output
  }
  const output = text.slice(0, outputLimit)
  return output.length < text.length ? `${output}\n... file truncated; request a line range to continue` : output
}

export async function writeWorkspaceFile(
  context: AgentToolContext,
  input: string,
  content: string,
) {
  const target = await authorizedPath(context, 'write files', input)
  if (!target) return 'The user denied filesystem access.'
  await mkdir(dirname(target.path), { recursive: true })
  let previous = ''
  try {
    if ((await stat(target.path)).size <= fileSizeLimit) {
      previous = await readFile(target.path, 'utf8')
      if (previous.includes('\0')) previous = ''
    }
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
  await replaceFile(target.path, content)
  return fileDiff(input, previous, content) || `Wrote ${target.path}; no changes detected.`
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
  const firstMatch = previous.indexOf(search)
  if (firstMatch < 0) {
    throw new Error('The exact text was not found in the file. Read the current file and retry.')
  }
  if (previous.indexOf(search, firstMatch + 1) >= 0) {
    throw new Error(
      'The exact text occurs more than once. Include surrounding lines so the target is unique.',
    )
  }
  const next = previous.replace(search, replacement)
  await replaceFile(target.path, next)
  return fileDiff(input, previous, next)
}

export async function editWorkspaceLines(
  context: AgentToolContext,
  input: string,
  startLine: number,
  endLine: number,
  expectedText: string,
  replacement: string,
) {
  const target = await authorizedPath(context, 'replace files', input)
  if (!target) return 'The user denied filesystem access.'
  if ((await stat(target.path)).size > fileSizeLimit) {
    throw new Error('This file is larger than the 1 MB edit limit.')
  }

  const previous = await readFile(target.path, 'utf8')
  if (previous.includes('\0')) throw new Error('This tool edits text files only.')
  const lineEnding = previous.includes('\r\n') ? '\r\n' : '\n'
  const lines = previous.split(/\r?\n/)
  if (startLine < 1 || endLine < startLine) {
    throw new Error(
      'Use a one-based line range where endLine is greater than or equal to startLine.',
    )
  }
  if (endLine > lines.length) throw new Error(`The file has only ${lines.length} lines.`)

  const actual = lines.slice(startLine - 1, endLine).join('\n')
  if (actual !== expectedText.replace(/\r\n/g, '\n')) {
    throw new Error('Those lines changed since they were read. Read the current range and retry.')
  }
  const replacementLines = replacement ? replacement.split(/\r?\n/) : []
  lines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines)
  const next = lines.join(lineEnding)
  await replaceFile(target.path, next)
  return fileDiff(input, previous, next) || `Updated ${target.path}; no changes detected.`
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
