import { afterEach, describe, expect, it } from 'bun:test'

import { agentOSBrowserUseRunnerTestables } from '../agentos-browser-use-runner'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('AgentOS Brave ChatGPT runner', () => {
  it('opens a ChatGPT target when Brave CDP is available but has no page targets', async () => {
    const requests: Array<{ url: string; method: string }> = []

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, method: init?.method || 'GET' })

      if (url.includes('/json/list')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (url.includes('/json/new?')) {
        return new Response(JSON.stringify({
          id: 'chatgpt-target',
          title: 'ChatGPT',
          type: 'page',
          url: 'https://chatgpt.com/',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9233/devtools/page/chatgpt-target',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const target = await agentOSBrowserUseRunnerTestables.waitForChatGptTarget(
      9233,
      'https://chatgpt.com/',
      1_000,
    )

    expect(target.id).toBe('chatgpt-target')
    expect(requests.some((request) => request.url.includes('/json/new?'))).toBe(true)
  })
})
