import { describe, expect, it } from 'bun:test'

import {
  renderAgentOSBrowserUseContext,
  resolveAgentOSBrowserUseCapability,
} from '../agentos-browser-use'

describe('AgentOS Browser Use capability', () => {
  it('uses Brave with an isolated profile when the executable exists', () => {
    const capability = resolveAgentOSBrowserUseCapability({
      env: {},
      homeDir: '/Users/tester',
      exists: (path) => path === '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    })

    expect(capability.enabled).toBe(true)
    expect(capability.provider).toBe('brave')
    expect(capability.executablePath).toBe('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')
    expect(capability.profileDir).toBe('/Users/tester/.craft-agent/agentos/browser-use/brave-profile')
    expect(capability.policy).toBe('read_only')
  })

  it('can be disabled without changing provider settings', () => {
    const capability = resolveAgentOSBrowserUseCapability({
      env: { CRAFT_AGENTOS_BROWSER_USE: 'off' },
      homeDir: '/Users/tester',
      exists: () => true,
    })

    expect(capability.enabled).toBe(false)
    expect(capability.reason).toContain('disabled')
  })

  it('renders a read-only Brave policy for skill prompts', () => {
    const context = renderAgentOSBrowserUseContext({
      enabled: true,
      provider: 'brave',
      browserName: 'Brave Browser',
      executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      profileDir: '/Users/tester/.craft-agent/agentos/browser-use/brave-profile',
      remoteDebuggingPort: 9233,
      policy: 'read_only',
    })

    expect(context).toContain('<BROWSER_USE>')
    expect(context).toContain('browser: Brave Browser')
    expect(context).toContain('policy: read_only')
    expect(context).toContain('blocked_actions: login, submit forms, post content')
    expect(context).toContain('--remote-debugging-port=9233')
  })
})
