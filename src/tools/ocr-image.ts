import { tool } from 'ai'
import { createWorker } from 'tesseract.js'
import { z } from 'zod'
import type { ChatImage } from '@/stores/app-store'

const maximumImageBytes = 15_000_000

export function ocrImage(options: {
  images: ChatImage[]
  readPath: (path: string) => Promise<Buffer>
}) {
  return tool({
    description:
      'Extract visible text from an image. Supply a chat attachment index (0 = most recent image), an image path, or base64 image data. Files outside a chat folder require user approval.',
    inputSchema: z.object({
      attachmentIndex: z.number().int().nonnegative().optional(),
      path: z.string().min(1).max(1_000).optional(),
      data: z.string().min(1).max(20_000_000).optional(),
    }),
    execute: async ({ attachmentIndex, path, data }) => {
      if (
        [attachmentIndex !== undefined, Boolean(path), Boolean(data)].filter(Boolean).length !== 1
      ) {
        throw new Error('Supply exactly one of attachmentIndex, path, or data.')
      }
      const encoded = (
        attachmentIndex !== undefined ? options.images[attachmentIndex]?.data : data
      )?.replace(/^data:[^,]+,/, '')
      if (encoded && encoded.length > (maximumImageBytes * 4) / 3 + 10)
        throw new Error('OCR images must be 15 MB or smaller.')
      const source = path ? await options.readPath(path) : Buffer.from(encoded ?? '', 'base64')
      if (!source.length)
        throw new Error('The image was empty or the attachment index was unavailable.')
      if (source.length > maximumImageBytes) throw new Error('OCR images must be 15 MB or smaller.')
      const worker = await createWorker('eng')
      try {
        const result = await worker.recognize(source)
        return { text: result.data.text.trim(), confidence: result.data.confidence }
      } finally {
        await worker.terminate()
      }
    },
  })
}
