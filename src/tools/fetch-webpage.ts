import { tool } from 'ai'
import { z } from 'zod'
import { outputLimit } from '@/services/workspace-access'

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}

export const fetchWebpage = tool({
  description: 'Fetch and extract readable text from a public webpage URL.',
  inputSchema: z.object({ url: z.url() }),
  execute: async ({ url }) => {

    for (let redirects = 0; redirects < 5; redirects++) {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000),
        headers: { 'User-Agent': 'Motif desktop app' },
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) throw new Error('The webpage returned an invalid redirect.')
        url = new URL(location, url).toString()
        continue
      }
      if (!response.ok) throw new Error(`Webpage fetch failed (${response.status})`)

      const html = await response.text()
      const text = html
        .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<(br|\/p|\/div|\/h[1-6]|\/li)[^>]*>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
      const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''

      return {
        url: url.toString(),
        title: decodeHtml(title).trim(),
        text: decodeHtml(text).slice(0, outputLimit),
      }
    }

    throw new Error('The webpage redirected too many times.')
  },
})
