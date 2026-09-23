import { tool } from 'ai'
import { z } from 'zod'

const resultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string().nullish(),
  engine: z.string().nullish(),
  publishedDate: z.string().nullish(),
  img_src: z.string().nullish(),
  thumbnail: z.string().nullish(),
})

const searchResponseSchema = z.object({ results: z.array(resultSchema) })
const querySchema = z.object({
  query: z.string().trim().min(1).max(500),
  timeRange: z.enum(['day', 'week', 'month', 'year']).optional(),
})

async function querySearxng(
  instanceUrl: string,
  query: string,
  category: 'general' | 'news' | 'images',
  timeRange?: string,
  signal?: AbortSignal,
) {
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
  url.searchParams.set('categories', category)
  if (timeRange) url.searchParams.set('time_range', timeRange)

  const timeout = AbortSignal.timeout(20_000)
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (response.status === 403) {
    throw new Error(
      'SearXNG rejected JSON search (403). Enable json in search.formats on the instance.',
    )
  }
  if (!response.ok) {
    throw new Error(
      `Web search failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
    )
  }
  const parsed = searchResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new Error('SearXNG returned an invalid JSON search response.')
  return parsed.data.results
}

function resultDetails(result: z.infer<typeof resultSchema>) {
  return {
    title: result.title,
    url: result.url,
    snippet: (result.content ?? '').slice(0, 1_200),
    ...(result.engine ? { source: result.engine } : {}),
    ...(result.publishedDate ? { publishedDate: result.publishedDate } : {}),
  }
}

export function searchWeb(instanceUrl: string, signal?: AbortSignal) {
  return tool({
    description:
      'Search the public web for current information. Optionally filter by recency; results include source and publication date when available.',
    inputSchema: querySchema,
    execute: async ({ query, timeRange }) =>
      (await querySearxng(instanceUrl, query, 'general', timeRange, signal))
        .slice(0, 8)
        .map(resultDetails),
  })
}

export function searchNews(instanceUrl: string, signal?: AbortSignal) {
  return tool({
    description:
      'Search news coverage. Use timeRange to focus on recent reporting; results include publication dates when the search engine provides them.',
    inputSchema: querySchema,
    execute: async ({ query, timeRange }) =>
      (await querySearxng(instanceUrl, query, 'news', timeRange, signal))
        .slice(0, 8)
        .map(resultDetails),
  })
}

export function searchImages(instanceUrl: string, signal?: AbortSignal) {
  return tool({
    description:
      'Search the public web for images. Returns direct image URLs and the pages where they appear; check licenses before reuse.',
    inputSchema: z.object({ query: z.string().trim().min(1).max(500) }),
    execute: async ({ query }) =>
      (await querySearxng(instanceUrl, query, 'images', undefined, signal))
        .filter((result) => result.img_src || result.thumbnail)
        .slice(0, 8)
        .map((result) => ({
          title: result.title,
          pageUrl: result.url,
          imageUrl: result.img_src ?? result.thumbnail,
          ...(result.thumbnail ? { thumbnailUrl: result.thumbnail } : {}),
          ...(result.engine ? { source: result.engine } : {}),
        })),
  })
}
