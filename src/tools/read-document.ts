import { lstat, readFile } from 'node:fs/promises'
import { tool } from 'ai'
import { z } from 'zod'
import type { AgentToolContext } from '@/services/agent-tool-context'
import {
  approvePath,
  outputLimit,
  readWorkspaceFile,
  resolveWorkspacePath,
} from '@/services/workspace-access'

export function readDocument(context: AgentToolContext) {
  return tool({
    description:
      'Extract text from a PDF, DOCX, or plain-text document in the chat folder. Without a folder, request approval.',
    inputSchema: z.object({ path: z.string().min(1) }),
    execute: async ({ path }) => {
      if (!/\.(pdf|docx?|odt)$/i.test(path)) return readWorkspaceFile(context, path)
      if (/\.(doc|odt)$/i.test(path)) {
        throw new Error('This reader supports PDF and DOCX, not legacy DOC or ODT files.')
      }

      const { path: filePath } = await resolveWorkspacePath(context.folder, path)
      if (!(await approvePath(context, 'read document', filePath)))
        return 'The user denied filesystem access.'
      if ((await lstat(filePath)).size > 20_000_000) {
        throw new Error('This document is larger than the 20 MB read limit.')
      }

      if (/\.docx$/i.test(path)) {
        const mammoth = (await import('mammoth')).default
        return (await mammoth.extractRawText({ path: filePath })).value.slice(0, outputLimit)
      }

      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const loadingTask = getDocument({ data: new Uint8Array(await readFile(filePath)) })
      try {
        const document = await loadingTask.promise
        const pages: string[] = []
        let textLength = 0

        for (
          let pageNumber = 1;
          pageNumber <= document.numPages && textLength < outputLimit;
          pageNumber++
        ) {
          const page = await document.getPage(pageNumber)
          const content = await page.getTextContent()
          const text = content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' ')
          pages.push(text)
          textLength += text.length + 1
        }

        return pages.join('\n').slice(0, outputLimit)
      } finally {
        // The loading task owns the PDF worker and must be destroyed, including on parse errors.
        await loadingTask.destroy()
      }
    },
  })
}
