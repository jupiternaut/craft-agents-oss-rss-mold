#!/usr/bin/env bun

import { homedir } from 'node:os'
import { join } from 'node:path'

import { createAgentOSBrowserWorkerService } from '../apps/electron/src/main/skill-crew/agentos-browser-worker'
import { runAgentOSBraveChatGptImageE2E, runAgentOSBraveChatGptSmoke } from '../apps/electron/src/main/skill-crew/agentos-browser-use-runner'

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((arg) => arg.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)

  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0) return process.argv[index + 1]
  return undefined
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined
  const port = Number(value)
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : undefined
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : undefined
}

if (process.argv.includes('--help')) {
  console.log([
    'Usage: bun scripts/agentos-browser-smoke.ts [--port 9233] [--target-url https://chatgpt.com/]',
    '       bun scripts/agentos-browser-smoke.ts --e2e --prompt "..." [--output /tmp/agentos-image.png]',
    '',
    'Checks an existing Brave CDP ChatGPT target without opening a new tab or submitting.',
    'If the send button only appears after text input, writes and clears a temporary draft.',
    'Use --submit or --e2e to actually submit an image prompt and wait for capture.',
    'Diagnostics are written to ~/.craft-agent/agentos/browser-worker.',
  ].join('\n'))
  process.exit(0)
}

const port = parsePort(readFlag('port') || process.env.CRAFT_AGENTOS_BRAVE_CDP_PORT)
const targetUrl = readFlag('target-url') || process.env.CRAFT_AGENTOS_BROWSER_SMOKE_URL || 'https://chatgpt.com/'
const submitE2E = process.argv.includes('--submit') || process.argv.includes('--e2e')
const prompt = readFlag('prompt')
  || process.env.CRAFT_AGENTOS_BROWSER_E2E_PROMPT
  || 'Create one original fictional image for AgentOS Browser Worker end-to-end validation. No text overlay.'
const outputPath = readFlag('output')
  || process.env.CRAFT_AGENTOS_BROWSER_E2E_OUTPUT
  || join(homedir(), '.craft-agent', 'agentos', 'browser-worker', `e2e-image-${Date.now()}.png`)
const submitTimeoutMs = parsePositiveInt(readFlag('submit-timeout-ms') || process.env.CRAFT_AGENTOS_BROWSER_E2E_SUBMIT_TIMEOUT_MS)
const waitForImageMs = parsePositiveInt(readFlag('wait-ms') || process.env.CRAFT_AGENTOS_BROWSER_E2E_WAIT_MS)

async function main(): Promise<void> {
  const worker = createAgentOSBrowserWorkerService({ enableHttp: false })
  const result = await (submitE2E
    ? runAgentOSBraveChatGptImageE2E({
      port,
      targetUrl,
      prompt,
      outputPath,
      submitTimeoutMs,
      waitForImageMs,
      dependencies: {
        worker,
      },
    })
    : runAgentOSBraveChatGptSmoke({
      port,
      targetUrl,
      dependencies: {
        worker,
      },
    })).finally(() => worker.close())

  console.log(JSON.stringify(result, null, 2))

  if (!result.success) {
    console.error(`AgentOS Browser ${submitE2E ? 'E2E' : 'smoke'} failed: ${result.error || result.diagnostics}`)
    process.exit(1)
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
