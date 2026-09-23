import { tool } from 'ai'
import { z } from 'zod'

export const copyToClipboard = tool({
  description: 'Copy text to the user’s system clipboard.',
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }) => {
    nw.Clipboard.set(text, 'text')
    return 'Copied to clipboard.'
  },
})

export const readClipboard = tool({
  description: 'Read text currently available on the user’s system clipboard.',
  inputSchema: z.object({}),
  execute: async () => nw.Clipboard.get('text'),
})
