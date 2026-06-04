import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAgentOSBrowserWorkerService } from '../agentos-browser-worker'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('AgentOS browser worker', () => {
  it('persists observable status snapshots and diagnostic events', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'agentos-browser-worker-'))
    tempDirs.push(storageDir)

    const worker = createAgentOSBrowserWorkerService({
      storageDir,
      enableHttp: false,
    })

    await worker.startRun({
      runId: 'run-1',
      task: 'chatgpt_image',
      targetUrl: 'https://chatgpt.com/',
      prompt: 'Create one fictional social-media image.',
      capturePath: '/tmp/image.png',
    })
    await worker.record({
      runId: 'run-1',
      phase: 'browser_prompt',
      status: 'info',
      message: '已连接 ChatGPT 页面',
      detail: 'https://chatgpt.com/c/test',
      snapshot: {
        target: {
          id: 'target-1',
          url: 'https://chatgpt.com/c/test',
          title: 'ChatGPT',
        },
        chatgpt: {
          inputFound: true,
          submitFound: true,
          promptInserted: true,
          promptLength: 38,
        },
      },
    })
    await worker.finishRun({
      runId: 'run-1',
      status: 'ok',
      message: 'Browser worker 已完成图片捕获',
    })

    const status = JSON.parse(await readFile(join(storageDir, 'latest-status.json'), 'utf-8'))
    expect(status.current.snapshot.target.url).toBe('https://chatgpt.com/c/test')
    expect(status.current.snapshot.chatgpt.promptInserted).toBe(true)
    expect(status.current.snapshot.chatgpt.capturePath).toBe('/tmp/image.png')

    const log = await readFile(join(storageDir, 'diagnostic-log.jsonl'), 'utf-8')
    expect(log).toContain('"phase":"browser_prompt"')
    expect(log).toContain('"phase":"worker_finish"')
  })

  it('rejects a different active run and preserves the current run', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'agentos-browser-worker-'))
    tempDirs.push(storageDir)

    const worker = createAgentOSBrowserWorkerService({
      storageDir,
      enableHttp: false,
    })

    await worker.startRun({
      runId: 'run-active',
      task: 'chatgpt_prompt',
      targetUrl: 'https://chatgpt.com/',
      prompt: 'Create an image.',
    })

    await expect(worker.startRun({
      runId: 'run-rejected',
      task: 'chatgpt_prompt',
      targetUrl: 'https://chatgpt.com/g/g-test',
      prompt: 'Create another image.',
    })).rejects.toThrow('Browser worker already has an active run: run-active')

    const status = worker.status()
    expect(status.current.runId).toBe('run-active')
    expect(status.current.snapshot?.runId).toBe('run-active')
    expect(status.recentEvents[0].phase).toBe('worker_reject')
    expect(status.recentEvents[0].detail).toContain('rejectedRunId=run-rejected')
  })

  it('adds target, selectors, and DOM diagnostics to failure evidence', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'agentos-browser-worker-'))
    tempDirs.push(storageDir)

    const worker = createAgentOSBrowserWorkerService({
      storageDir,
      enableHttp: false,
    })

    await worker.startRun({
      runId: 'run-fail',
      task: 'chatgpt_prompt',
      targetUrl: 'https://chatgpt.com/',
      prompt: 'Create an image.',
    })
    await worker.record({
      runId: 'run-fail',
      phase: 'browser_error',
      status: 'error',
      message: 'ChatGPT prompt input not found',
      detail: 'promptMatches=0; visibleEditable=0; sendButtons=0; body=Sign in to ChatGPT',
      evidence: 'ChatGPT prompt input not found',
      snapshot: {
        chatgpt: {
          inputFound: false,
          submitFound: false,
          diagnostics: 'promptMatches=0; visibleEditable=0; sendButtons=0; body=Sign in to ChatGPT',
        },
      },
    })

    const event = worker.status().recentEvents[0]
    expect(event.evidence).toContain('targetUrl=https://chatgpt.com/')
    expect(event.evidence).toContain('inputSelector=missing')
    expect(event.evidence).toContain('submitSelector=missing')
    expect(event.evidence).toContain('dom=promptMatches=0')
  })

  it('persists smoke failure evidence when ChatGPT target is missing', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'agentos-browser-worker-'))
    tempDirs.push(storageDir)

    const worker = createAgentOSBrowserWorkerService({
      storageDir,
      enableHttp: false,
    })

    await worker.startRun({
      runId: 'run-smoke',
      task: 'chatgpt_prompt',
      targetUrl: 'https://chatgpt.com/',
      prompt: 'AgentOS Browser Worker smoke check. Do not submit.',
    })
    await worker.record({
      runId: 'run-smoke',
      phase: 'browser_smoke',
      status: 'error',
      message: 'Browser smoke 未通过 ChatGPT DOM 检查',
      detail: 'No ChatGPT page target found; CDP has 1 page target(s): Example <https://example.com/>',
      evidence: 'No ChatGPT page target found; CDP has 1 page target(s): Example <https://example.com/>',
      snapshot: {
        chatgpt: {
          inputFound: false,
          submitFound: false,
          diagnostics: 'No ChatGPT page target found; CDP has 1 page target(s): Example <https://example.com/>',
        },
      },
    })

    const event = worker.status().recentEvents[0]
    expect(event.phase).toBe('browser_smoke')
    expect(event.evidence).toContain('No ChatGPT page target found')
    expect(event.evidence).toContain('inputSelector=missing')
    expect(event.evidence).toContain('submitSelector=missing')

    const log = await readFile(join(storageDir, 'diagnostic-log.jsonl'), 'utf-8')
    expect(log).toContain('"phase":"browser_smoke"')
    expect(log).toContain('No ChatGPT page target found')
  })

  it('exposes local health, status, snapshot, diagnostics, and limited reset control', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'agentos-browser-worker-'))
    tempDirs.push(storageDir)

    const worker = createAgentOSBrowserWorkerService({
      storageDir,
      enableHttp: true,
      port: 0,
    })
    await worker.startRun({
      runId: 'run-2',
      task: 'chatgpt_prompt',
      targetUrl: 'https://chatgpt.com/',
      prompt: 'Create an image.',
    })
    await worker.record({
      runId: 'run-2',
      phase: 'browser_prompt',
      status: 'info',
      message: '已连接 ChatGPT 页面',
      snapshot: {
        chatgpt: {
          inputFound: true,
          promptSelector: '#prompt-textarea',
          submitFound: true,
          submitSelector: '#composer-submit-button',
        },
      },
    })

    const statusUrl = worker.getStatusUrl()
    expect(statusUrl).toBeTruthy()
    const baseUrl = statusUrl!.replace('/status', '')
    const health = await fetch(statusUrl!.replace('/status', '/health')).then((response) => response.json())
    expect(health.ok).toBe(true)
    expect(health.service).toBe('agentos-browser-worker')

    const status = await fetch(`${baseUrl}/status`).then((response) => response.json())
    expect(status.current.runId).toBe('run-2')
    expect(status.current.snapshot.chatgpt.promptSelector).toBe('#prompt-textarea')

    const snapshot = await fetch(`${baseUrl}/snapshot`).then((response) => response.json())
    expect(snapshot.chatgpt.submitSelector).toBe('#composer-submit-button')

    const diagnostics = await fetch(`${baseUrl}/diagnostics/recent`).then((response) => response.json())
    expect(diagnostics.events[0].phase).toBe('browser_prompt')

    const reset = await fetch(`${baseUrl}/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reset' }),
    }).then((response) => response.json())
    expect(reset.ok).toBe(true)
    expect(worker.status().current.runId).toBeUndefined()

    const resetSnapshot = await fetch(`${baseUrl}/snapshot`).then((response) => response.json())
    expect(resetSnapshot).toBeNull()
    await worker.close()
  })
})
