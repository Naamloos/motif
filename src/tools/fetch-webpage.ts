import { tool } from 'ai'
import { isIP } from 'node:net'
import { z } from 'zod'
import { outputLimit } from '@/services/workspace-access'

function publicWebUrl(input: string) {
  const url = new URL(input)
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  const address = hostname.replace(/^\[|\]$/g, '')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only public HTTP(S) webpages can be fetched.')
  }
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home')
  ) {
    throw new Error('Local and internal network addresses cannot be fetched.')
  }
  if (isIP(address) === 6) {
    throw new Error('Fetch IPv6 webpages by hostname rather than a direct address.')
  }
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    ) {
      throw new Error('Private, loopback, link-local, and reserved IP addresses cannot be fetched.')
    }
  }
  return url.toString()
}

function extractPage(html: string, pageUrl: string) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  document
    .querySelectorAll('script, style, noscript, svg, nav, footer, header, aside, form, button')
    .forEach((element) => element.remove())
  const content = document.querySelector('article, main') ?? document.body
  const text = (content as HTMLElement).innerText || content.textContent || ''
  const links = Array.from(content.querySelectorAll('a[href]'))
    .map((anchor) => {
      try {
        const link = new URL(anchor.getAttribute('href')!, pageUrl)
        if (!['http:', 'https:'].includes(link.protocol)) return null
        return { title: anchor.textContent?.trim() || link.hostname, url: link.toString() }
      } catch {
        return null
      }
    })
    .filter((link): link is { title: string; url: string } => link !== null)
    .slice(0, 30)

  return {
    title: document.title.trim(),
    text: text.replace(/\n{3,}/g, '\n\n').trim().slice(0, outputLimit),
    links,
  }
}

export function fetchWebpage(signal?: AbortSignal) {
  return tool({
    description:
      'Fetch readable text and relevant outbound links from a public webpage. Use returned links to follow cited sources.',
    inputSchema: z.object({ url: z.url() }),
    execute: async ({ url }) => {
      for (let redirects = 0; redirects < 5; redirects++) {
        url = publicWebUrl(url)
        const timeout = AbortSignal.timeout(12_000)
        const response = await fetch(url, {
          redirect: 'manual',
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          headers: { 'User-Agent': 'Motif desktop app' },
        })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location) throw new Error('The webpage returned an invalid redirect.')
          url = new URL(location, url).toString()
          continue
        }
        if (!response.ok) throw new Error(`Webpage fetch failed (${response.status})`)
        const type = response.headers.get('content-type') ?? ''
        if (!type.includes('text/html') && !type.includes('text/plain')) {
          throw new Error(`Unsupported webpage content type: ${type || 'unknown'}`)
        }
        const contentLength = Number(response.headers.get('content-length'))
        if (Number.isFinite(contentLength) && contentLength > 5_000_000) {
          throw new Error('The webpage is larger than the 5 MB fetch limit.')
        }
        const text = await response.text()
        if (text.length > 5_000_000) {
          throw new Error('The webpage is larger than the 5 MB fetch limit.')
        }
        if (type.includes('text/plain')) {
          return { url, title: new URL(url).hostname, text: text.slice(0, outputLimit), links: [] }
        }
        return { url, ...extractPage(text, url) }
      }
      throw new Error('The webpage redirected too many times.')
    },
  })
}
