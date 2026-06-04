import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type AgentOSBrowserUseCapability = {
  enabled: boolean
  provider: 'brave'
  browserName: 'Brave Browser'
  executablePath: string
  profileDir: string
  remoteDebuggingPort: number
  policy: 'read_only'
  reason?: string
}

const DEFAULT_BRAVE_EXECUTABLE_PATH = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
const DEFAULT_BRAVE_DEBUGGING_PORT = 9233

function parsePort(value: string | undefined): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return DEFAULT_BRAVE_DEBUGGING_PORT
  }
  return port
}

function isDisabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLocaleLowerCase()
  return normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'disabled' || normalized === 'none'
}

export function resolveAgentOSBrowserUseCapability(args: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
  exists?: (path: string) => boolean
} = {}): AgentOSBrowserUseCapability {
  const env = args.env ?? process.env
  const homeDir = args.homeDir ?? homedir()
  const exists = args.exists ?? existsSync
  const executablePath = env.CRAFT_AGENTOS_BRAVE_PATH?.trim() || DEFAULT_BRAVE_EXECUTABLE_PATH
  const profileDir = env.CRAFT_AGENTOS_BRAVE_PROFILE_DIR?.trim()
    || join(homeDir, '.craft-agent', 'agentos', 'browser-use', 'brave-profile')
  const remoteDebuggingPort = parsePort(env.CRAFT_AGENTOS_BRAVE_CDP_PORT)

  const base: Omit<AgentOSBrowserUseCapability, 'enabled' | 'reason'> = {
    provider: 'brave',
    browserName: 'Brave Browser',
    executablePath,
    profileDir,
    remoteDebuggingPort,
    policy: 'read_only',
  }

  if (isDisabled(env.CRAFT_AGENTOS_BROWSER_USE)) {
    return {
      ...base,
      enabled: false,
      reason: 'AgentOS Browser Use disabled by CRAFT_AGENTOS_BROWSER_USE',
    }
  }

  if (!exists(executablePath)) {
    return {
      ...base,
      enabled: false,
      reason: `Brave executable not found at ${executablePath}`,
    }
  }

  return {
    ...base,
    enabled: true,
  }
}

export function renderAgentOSBrowserUseContext(capability: AgentOSBrowserUseCapability): string {
  const lines = [
    '<BROWSER_USE>',
    `enabled: ${capability.enabled ? 'true' : 'false'}`,
    `provider: ${capability.provider}`,
    `browser: ${capability.browserName}`,
    `executable_path: ${capability.executablePath}`,
    `profile_dir: ${capability.profileDir}`,
    `remote_debugging_port: ${capability.remoteDebuggingPort}`,
    `policy: ${capability.policy}`,
  ]

  if (!capability.enabled) {
    lines.push(`reason: ${capability.reason || 'unavailable'}`)
    lines.push('instruction: If browser context is necessary and unavailable, return <SILENCE/> or state the missing source context in the moment body.')
    lines.push('</BROWSER_USE>')
    return lines.join('\n')
  }

  lines.push(
    'instruction: AgentOS Browser Use is available only for read-only context gathering.',
    'instruction: Prefer source digests first; use Brave only when the current moment needs fresh page context, visual inspection, or source verification.',
    'allowed_actions: open, navigate, read visible page text, inspect public pages, take screenshots, collect source URLs',
    'blocked_actions: login, submit forms, post content, purchase, delete, change account settings, access private user data, bypass paywalls or security challenges',
    `launch_hint: start once with "${capability.executablePath}" --user-data-dir="${capability.profileDir}" --remote-debugging-port=${capability.remoteDebuggingPort} --no-first-run <url>; then reuse the existing CDP tab instead of opening new windows`,
    'output_rule: Do not include tool logs. If browsing changes your decision, publish the resulting moment body or return <SILENCE/>.',
    '</BROWSER_USE>',
  )

  return lines.join('\n')
}
