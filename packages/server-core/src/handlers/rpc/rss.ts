import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

const MAX_FEED_TEXT_CHARS = 1_000_000
const FEED_REQUEST_TIMEOUT_MS = 12_000

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.rss.FETCH_FEED_TEXT,
] as const

export function registerRssHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.rss.FETCH_FEED_TEXT, async (_ctx, rawUrl: string) => {
    const url = new URL(rawUrl)
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Only http and https feeds are supported')
    }

    deps.platform.logger.info(`[rss] Fetching feed text from ${url.toString()}`)

    const response = await fetch(url, {
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml;q=0.9, text/xml;q=0.9, text/plain;q=0.2',
        'User-Agent': 'Craft Agents RSS Reader/0.1',
      },
      signal: AbortSignal.timeout(FEED_REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`Feed request failed with ${response.status} ${response.statusText}`)
    }

    const text = await response.text()
    if (text.length > MAX_FEED_TEXT_CHARS) {
      throw new Error(`Feed payload too large (${text.length} chars)`)
    }

    return text
  })
}
