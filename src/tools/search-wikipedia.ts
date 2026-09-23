import { tool } from 'ai'
import { z } from 'zod'

const wikipediaSearchResponse = z.object({
  pages: z.array(
    z.object({
      title: z.string(),
      key: z.string(),
      excerpt: z.string(),
      description: z.string().nullable().optional(),
    }),
  ),
})

export function searchWikipedia(signal?: AbortSignal) {
  return tool({
    description: 'Search English Wikipedia articles and return titles, links, and short excerpts.',
    inputSchema: z.object({
      query: z.string().trim().min(1).max(200).describe('What to search for on Wikipedia'),
    }),
    execute: async ({ query }) => {
      const url = new URL('https://en.wikipedia.org/w/rest.php/v1/search/page')
      url.searchParams.set('q', query)
      url.searchParams.set('limit', '5')

      const timeout = AbortSignal.timeout(10_000)
      const response = await fetch(url, {
        headers: { 'Api-User-Agent': 'Motif desktop app' },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })

      if (!response.ok) {
        throw new Error(`Wikipedia search failed (${response.status})`)
      }

      const { pages } = wikipediaSearchResponse.parse(await response.json())
      return pages.map((page) => ({
        title: page.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key)}`,
        description: page.description,
        excerpt: page.excerpt.replace(/<[^>]*>/g, ''),
      }))
    },
  })
}
