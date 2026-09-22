import { tool } from 'ai'
import { z } from 'zod'

const searchResultsSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string().nullish(),
    }),
  ),
})

export function searchWeb(instanceUrl: string) {
  return tool({
    description:
      'Search the public web for current information and return relevant titles, URLs, and snippets.',
    inputSchema: z.object({ query: z.string().trim().min(1).max(500) }),
    execute: async ({ query }) => {
      if (!instanceUrl.trim()) {
        throw new Error('Configure a SearXNG instance URL in Settings before using web search.')
      }
      let url: URL
      try {
        url = new URL(instanceUrl.trim())
      } catch {
        throw new Error('Configure a valid SearXNG instance URL in Settings.')
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new Error(
          'SearXNG instance URL must use HTTP(S) without credentials, a query, or a fragment.',
        )
      }
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/search`
      url.searchParams.set('q', query)
      url.searchParams.set('format', 'json')
      url.searchParams.set('safesearch', '0')
      url.searchParams.set('language', 'en-US')
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })
      if (response.status === 403) {
        throw new Error(
          'SearXNG rejected JSON search (403). Enable json in search.formats on the instance.',
        )
      }
      if (!response.ok)
        throw new Error(
          `Web search failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
        )
      const data = searchResultsSchema.safeParse(await response.json())
      if (!data.success) throw new Error('SearXNG returned an invalid JSON search response.')
      return data.data.results.slice(0, 5).map(({ title, url, content }) => ({
        title,
        url,
        snippet: content ?? '',
      }))
    },
  })
}
