import { lstat, readFile } from 'node:fs/promises'
import type { AgentToolContext } from '@/services/agent-tool-context'
import { approvePath, resolveWorkspacePath } from '@/services/workspace-access'
import { askUser } from '@/tools/ask-user'
import { fetchWebpage } from '@/tools/fetch-webpage'
import { editFile } from '@/tools/edit-file'
import { findFiles } from '@/tools/find-files'
import { findDefinition } from '@/tools/find-definition'
import { getFileTree } from '@/tools/get-file-tree'
import { inspectWorkspaceTool } from '@/tools/inspect-workspace'
import { listFiles } from '@/tools/list-files'
import { manageTasks } from '@/tools/manage-tasks'
import { ocrImage } from '@/tools/ocr-image'
import { openInBrowser } from '@/tools/open-in-browser'
import { patchFile } from '@/tools/patch-file'
import { readDocument } from '@/tools/read-document'
import { readTextFile } from '@/tools/read-file'
import { runCommand } from '@/tools/run-command'
import { saveMemory } from '@/tools/save-memory'
import { manageMemories } from '@/tools/manage-memories'
import { searchChats } from '@/tools/search-chats'
import { searchFiles } from '@/tools/search-files'
import { writeTextFile } from '@/tools/write-file'
import { git } from '@/tools/git'
import { copyToClipboard, readClipboard } from '@/tools/clipboard'

export function createAgentTools(context: AgentToolContext) {
  return {
    fetchWebpage: fetchWebpage(context.abortSignal),
    listFiles: listFiles(context),
    findFiles: findFiles(context),
    findDefinition: findDefinition(context),
    getFileTree: getFileTree(context),
    inspectWorkspace: inspectWorkspaceTool(context),
    searchFiles: searchFiles(context),
    readFile: readTextFile(context),
    editFile: editFile(context),
    readDocument: readDocument(context),
    writeFile: writeTextFile(context),
    patchFile: patchFile(context),
    runCommand: runCommand(context),
    git: git(context),
    askUser: askUser(context),
    manageTasks: manageTasks(context),
    searchChats: searchChats(context),
    saveMemory: saveMemory(context),
    manageMemories: manageMemories(context),
    openInBrowser: openInBrowser(context),
    copyToClipboard,
    readClipboard,
    ocrImage: ocrImage({
      images: context.images,
      readPath: async (input) => {
        const { path } = await resolveWorkspacePath(context.folder, input)
        if (!(await approvePath(context, 'read image for OCR', path))) {
          throw new Error('The user denied image access.')
        }
        if ((await lstat(path)).size > 15_000_000) {
          throw new Error('OCR images must be 15 MB or smaller.')
        }
        return readFile(path)
      },
    }),
  }
}
