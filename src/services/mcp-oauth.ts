import { randomBytes, X509Certificate } from 'node:crypto'
import { createServer, type RequestListener } from 'node:http'
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  auth,
  type OAuthAuthorizationServerInformation,
  type OAuthClientInformation,
  type OAuthClientProvider,
  type OAuthTokens,
} from '@ai-sdk/mcp'
import { generate } from 'selfsigned'
import type { McpServerConfig } from '@/services/mcp-service'

type Credentials = {
  serverUrl: string
  redirectUrl?: string
  tokens?: OAuthTokens
  client?: OAuthClientInformation
  authorizationServer?: OAuthAuthorizationServerInformation
  verifier?: string
  state?: string
}

const credentialsFile = join(nw.App.dataPath, 'motif-mcp-oauth.json')
const callbackCertificateFile = join(nw.App.dataPath, 'motif-mcp-oauth-localhost-cert.json')
const callbackTimeoutMs = 120_000
export const defaultMcpOAuthCallbackPort = 8765

async function callbackCertificate(): Promise<{ key: string; cert: string }> {
  let saved: { key: string; cert: string } | undefined
  try {
    saved = JSON.parse(readFileSync(callbackCertificateFile, 'utf8'))
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      throw error
    }
  }
  if (saved && typeof saved.key === 'string' && typeof saved.cert === 'string') {
    try {
      if (Date.parse(new X509Certificate(saved.cert).validTo) > Date.now() + 86_400_000) {
        return saved
      }
    } catch {
      // Replace an invalid or expired certificate.
    }
  }
  const generated = await generate([{ name: 'commonName', value: 'localhost' }], {
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
    ],
  })
  const certificate = { key: generated.private, cert: generated.cert }
  mkdirSync(nw.App.dataPath, { recursive: true })
  const temporaryFile = `${callbackCertificateFile}.tmp`
  writeFileSync(temporaryFile, JSON.stringify(certificate), { mode: 0o600 })
  renameSync(temporaryFile, callbackCertificateFile)
  return certificate
}

// NW.js serves modules over HTTP, which breaks the SDK's Node fetch helper.
// Calendly's documented OAuth hosts are fixed, so use Node HTTPS for this flow.
const calendlyOAuthFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.protocol !== 'https:' || !['mcp.calendly.com', 'calendly.com'].includes(url.hostname)) {
    throw new Error(`Unexpected Calendly OAuth host: ${url.origin}`)
  }
  const body = init?.body?.toString()
  const headers = new Headers(init?.headers)
  if (body !== undefined) headers.set('Content-Length', String(Buffer.byteLength(body)))
  const response = await new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: init?.method ?? 'GET',
        headers: Object.fromEntries(headers),
        signal: init?.signal ?? undefined,
      },
      (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
        incoming.on('error', reject)
        incoming.on('end', () => {
          const responseHeaders = new Headers()
          for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
            responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1])
          }
          const status = incoming.statusCode ?? 500
          resolve(
            new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks).toString('utf8'), {
              status,
              statusText: incoming.statusMessage,
              headers: responseHeaders,
            }),
          )
        })
      },
    )
    request.on('error', reject)
    request.end(body)
  })
  if (init?.redirect === 'error' && response.status >= 300 && response.status < 400) {
    throw new TypeError(`OAuth request redirected: ${url.origin}${url.pathname}`)
  }
  // The SDK's error parser misses Response objects from another fetch realm in NW.js.
  if (response.ok || init?.method !== 'POST') return response
  const errorBody = (await response.text()).slice(0, 2000)
  throw new Error(`OAuth request to ${url.origin}${url.pathname} failed (HTTP ${response.status}): ${errorBody}`)
}

export function assertMcpOAuthServerUrl(url: URL) {
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  ) {
    throw new Error('OAuth MCP servers must use HTTPS, or loopback HTTP for local development.')
  }
}

function readCredentials(): Record<string, Credentials> {
  try {
    return JSON.parse(readFileSync(credentialsFile, 'utf8')) as Record<string, Credentials>
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

function writeCredentials(credentials: Record<string, Credentials>) {
  mkdirSync(nw.App.dataPath, { recursive: true })
  const temporaryFile = `${credentialsFile}.tmp`
  writeFileSync(temporaryFile, JSON.stringify(credentials), { mode: 0o600 })
  renameSync(temporaryFile, credentialsFile)
}

function savedFor(server: McpServerConfig): Credentials | undefined {
  const saved = readCredentials()[server.id]
  return saved?.serverUrl === server.url ? saved : undefined
}

function updateCredentials(server: McpServerConfig, change: Partial<Credentials>) {
  const all = readCredentials()
  all[server.id] = { serverUrl: server.url ?? '', ...savedFor(server), ...change }
  writeCredentials(all)
}

export function hasMcpOAuthTokens(server: McpServerConfig): boolean {
  return Boolean(savedFor(server)?.tokens?.access_token)
}

export function clearMcpOAuth(serverId: string) {
  const all = readCredentials()
  delete all[serverId]
  writeCredentials(all)
}

export function mcpOAuthProvider(
  server: McpServerConfig,
  redirectUrl?: string,
): OAuthClientProvider {
  const callback =
    redirectUrl ??
    savedFor(server)?.redirectUrl ??
    `${server.oauthCallbackHttps ? 'https' : 'http'}://127.0.0.1/callback`
  return {
    get redirectUrl() {
      return callback
    },
    get clientMetadata() {
      return {
        redirect_uris: [callback],
        application_type: 'native' as const,
        client_name: 'Motif',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }
    },
    tokens: () => savedFor(server)?.tokens,
    saveTokens: (tokens) => updateCredentials(server, { tokens }),
    clientInformation: () =>
      server.oauthClientId
        ? { client_id: server.oauthClientId, client_secret: server.oauthClientSecret || undefined }
        : savedFor(server)?.client,
    isClientInformationDynamicallyRegistered: () => !server.oauthClientId,
    saveClientInformation: (client) => updateCredentials(server, { client }),
    authorizationServerInformation: () => savedFor(server)?.authorizationServer,
    saveAuthorizationServerInformation: (authorizationServer) =>
      updateCredentials(server, { authorizationServer }),
    state: () => randomBytes(32).toString('base64url'),
    saveState: (state) => updateCredentials(server, { state }),
    storedState: () => savedFor(server)?.state,
    saveCodeVerifier: (verifier) => updateCredentials(server, { verifier }),
    codeVerifier: () => {
      const verifier = savedFor(server)?.verifier
      if (!verifier)
        throw new Error('The MCP OAuth code verifier is missing. Please sign in again.')
      return verifier
    },
    invalidateCredentials: (scope) => {
      const saved = savedFor(server)
      if (!saved) return
      if (scope === 'all') return clearMcpOAuth(server.id)
      updateCredentials(server, {
        ...(scope === 'tokens' ? { tokens: undefined } : {}),
        ...(scope === 'client' ? { client: undefined } : {}),
        ...(scope === 'verifier' ? { verifier: undefined } : {}),
      })
    },
    redirectToAuthorization: (url) => {
      if (!redirectUrl) throw new Error(`Sign in to ${server.name} from MCP settings.`)
      nw.Shell.openExternal(url.toString())
    },
  }
}

export async function signInMcpServer(server: McpServerConfig): Promise<void> {
  if (server.transport === 'stdio' || server.auth !== 'oauth' || !server.url) {
    throw new Error('OAuth is only available for remote MCP servers configured to use it.')
  }
  assertMcpOAuthServerUrl(new URL(server.url))
  const fetchFn = new URL(server.url).hostname === 'mcp.calendly.com' ? calendlyOAuthFetch : undefined

  const callbackPath = '/mcp-oauth/callback'
  let resolveCallback!: () => void
  let rejectCallback!: (error: Error) => void
  const callback = new Promise<void>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })
  // The callback can arrive before the initial discovery request settles.
  void callback.catch(() => {})
  let provider: OAuthClientProvider
  let callbackHandled = false
  const handleCallback: RequestListener = (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method !== 'GET' || url.pathname !== callbackPath) {
      response.writeHead(404).end()
      return
    }
    if (callbackHandled) {
      response.writeHead(409).end()
      return
    }
    const expectedState = savedFor(server)?.state
    if (!expectedState || url.searchParams.get('state') !== expectedState) {
      response.writeHead(400).end('Invalid OAuth state.')
      return
    }
    callbackHandled = true
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    if (!code || error) {
      const reason = new Error(error || 'The authorization response did not include a code.')
      response.writeHead(400, { 'Content-Type': 'text/plain' }).end(reason.message)
      rejectCallback(reason)
      return
    }
    void auth(provider, {
      serverUrl: server.url!,
      authorizationCode: code,
      callbackState: url.searchParams.get('state') ?? undefined,
      callbackIssuer: url.searchParams.get('iss') ?? undefined,
      fetchFn,
    }).then(
      (result) => {
        if (result !== 'AUTHORIZED' || !hasMcpOAuthTokens(server)) {
          const reason = new Error('The MCP server did not complete OAuth authorization.')
          response.writeHead(400, { 'Content-Type': 'text/plain' }).end(reason.message)
          rejectCallback(reason)
          return
        }
        response
          .writeHead(200, { 'Content-Type': 'text/plain' })
          .end('Motif is connected. You can close this tab.')
        resolveCallback()
      },
      (reason: unknown) => {
        response
          .writeHead(400, { 'Content-Type': 'text/plain' })
          .end('Authorization failed. Return to Motif and try again.')
        rejectCallback(reason instanceof Error ? reason : new Error(String(reason)))
      },
    )
  }
  const listener = server.oauthCallbackHttps
    ? createHttpsServer(await callbackCertificate(), handleCallback)
    : createServer(handleCallback)

  try {
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject)
      listener.listen(server.oauthCallbackPort ?? defaultMcpOAuthCallbackPort, '127.0.0.1', resolve)
    })
    const address = listener.address()
    if (!address || typeof address === 'string') throw new Error('Could not start OAuth callback.')
    const redirectUrl = `${server.oauthCallbackHttps ? 'https' : 'http'}://127.0.0.1:${address.port}${callbackPath}`

    // A dynamic registration is tied to its exact redirect URI. Re-register on a new sign-in.
    clearMcpOAuth(server.id)
    updateCredentials(server, { redirectUrl })
    provider = mcpOAuthProvider(server, redirectUrl)
    const result = await auth(provider, { serverUrl: server.url, fetchFn })
    if (result === 'REDIRECT') {
      const timeout = setTimeout(
        () => rejectCallback(new Error('MCP sign-in timed out.')),
        callbackTimeoutMs,
      )
      try {
        await callback
      } finally {
        clearTimeout(timeout)
      }
    }
  } finally {
    if (listener.listening) listener.close()
  }
}
