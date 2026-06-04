import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAgentOSBrowserWorkerService } from '../agentos-browser-worker'
import { agentOSBrowserUseRunnerTestables, runAgentOSBraveChatGptImageE2E, runAgentOSBraveChatGptSmoke } from '../agentos-browser-use-runner'

const originalFetch = globalThis.fetch
const DOM_GLOBALS = ['document', 'HTMLElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'InputEvent', 'getComputedStyle', 'location'] as const
const tempDirs: string[] = []

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

type FakeRect = {
  x: number
  y: number
  width: number
  height: number
}

type TestChatGptPromptState = {
  url: string
  title: string
  hasPrompt: boolean
  visiblePrompt: boolean
  inputTextLength: number
  promptSelector?: string
  hasSubmit?: boolean
  visibleSubmit?: boolean
  submitDisabled?: boolean
  submitSelector?: string
  diagnostics: string
}

class FakeHTMLElement {
  readonly tagName: string
  readonly attributes: Record<string, string>
  readonly rect: FakeRect
  innerText = ''
  textContent = ''
  innerHTML = ''
  disabled = false
  readOnly = false
  clicked = false
  ownerDocument?: FakeDocument

  constructor(tagName: string, attributes: Record<string, string> = {}, rect: FakeRect = { x: 0, y: 0, width: 320, height: 40 }) {
    this.tagName = tagName.toUpperCase()
    this.attributes = attributes
    this.rect = rect
  }

  get id(): string {
    return this.attributes.id || ''
  }

  get isContentEditable(): boolean {
    const contentEditable = this.getAttribute('contenteditable')
    return contentEditable === 'true' || contentEditable === 'plaintext-only'
  }

  get offsetWidth(): number {
    return this.rect.width
  }

  get offsetHeight(): number {
    return this.rect.height
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null
  }

  getBoundingClientRect(): FakeRect & { top: number; left: number } {
    return {
      ...this.rect,
      top: this.rect.y,
      left: this.rect.x,
    }
  }

  getClientRects(): FakeRect[] {
    return this.rect.width > 0 && this.rect.height > 0 ? [this.rect] : []
  }

  closest(selector: string): FakeHTMLElement | null {
    if (selector === '[aria-hidden="true"]' && this.getAttribute('aria-hidden') === 'true') {
      return this
    }
    return null
  }

  focus(): void {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this
    }
  }

  click(): void {
    this.clicked = true
  }

  appendChild(child: FakeHTMLElement): FakeHTMLElement {
    this.innerText += child.textContent
    this.textContent += child.textContent
    return child
  }

  dispatchEvent(): boolean {
    return true
  }
}

class FakeHTMLTextAreaElement extends FakeHTMLElement {
  value = ''
}

class FakeHTMLButtonElement extends FakeHTMLElement {}

class FakeDocument {
  activeElement?: FakeHTMLElement
  readonly body = new FakeHTMLElement('body')

  constructor(
    readonly elements: FakeHTMLElement[],
    readonly title = 'ChatGPT',
  ) {
    this.body.innerText = 'ChatGPT ready'
    for (const element of elements) {
      element.ownerDocument = this
    }
  }

  querySelectorAll(selector: string): FakeHTMLElement[] {
    return selector
      .split(',')
      .flatMap((part) => this.querySelectorAllSingle(part.trim()))
  }

  createElement(tagName: string): FakeHTMLElement {
    return new FakeHTMLElement(tagName)
  }

  execCommand(command: string, _showUi?: boolean, value?: string): boolean {
    if (!this.activeElement) return false

    if (command === 'selectAll') {
      return true
    }

    if (command === 'delete') {
      this.activeElement.innerText = ''
      this.activeElement.textContent = ''
      this.activeElement.innerHTML = ''
      return true
    }

    if (command === 'insertText') {
      const text = value || ''
      this.activeElement.innerText = text
      this.activeElement.textContent = text
      this.activeElement.innerHTML = text
      return true
    }

    return false
  }

  private querySelectorAllSingle(selector: string): FakeHTMLElement[] {
    if (selector === '#prompt-textarea') {
      return this.elements.filter((element) => element.id === 'prompt-textarea')
    }
    if (selector === '.ProseMirror[contenteditable="true"]') {
      return this.elements.filter((element) => (element.getAttribute('class') || '').split(/\s+/).includes('ProseMirror') && element.getAttribute('contenteditable') === 'true')
    }
    if (selector === '[contenteditable="true"][role="textbox"]') {
      return this.elements.filter((element) => element.getAttribute('contenteditable') === 'true' && element.getAttribute('role') === 'textbox')
    }
    if (selector === '[contenteditable="true"][data-placeholder]') {
      return this.elements.filter((element) => element.getAttribute('contenteditable') === 'true' && element.getAttribute('data-placeholder') !== null)
    }
    if (selector === '[contenteditable="plaintext-only"]') {
      return this.elements.filter((element) => element.getAttribute('contenteditable') === 'plaintext-only')
    }
    if (selector === 'main [contenteditable="true"]' || selector === '[contenteditable="true"]') {
      return this.elements.filter((element) => element.getAttribute('contenteditable') === 'true')
    }
    if (selector === 'textarea') {
      return this.elements.filter((element) => element instanceof FakeHTMLTextAreaElement)
    }
    if (selector.startsWith('textarea[')) {
      return this.elements.filter((element) => element instanceof FakeHTMLTextAreaElement)
    }
    if (selector === '[data-testid="prompt-textarea"]') {
      return this.elements.filter((element) => element.getAttribute('data-testid') === 'prompt-textarea')
    }
    if (selector === '[data-testid="composer-input"]') {
      return this.elements.filter((element) => element.getAttribute('data-testid') === 'composer-input')
    }
    if (selector === '[data-testid="composer"] [contenteditable="true"]') {
      return this.elements.filter((element) => element.getAttribute('contenteditable') === 'true' && element.getAttribute('data-inside-composer') === 'true')
    }
    if (selector === '[data-testid="send-button"]') {
      return this.elements.filter((element) => element.getAttribute('data-testid') === 'send-button')
    }
    if (selector === '#composer-submit-button') {
      return this.elements.filter((element) => element.id === 'composer-submit-button')
    }
    if (selector === 'button[aria-label*="Send"]') {
      return this.elements.filter((element) => element.tagName === 'BUTTON' && (element.getAttribute('aria-label') || '').includes('Send'))
    }
    if (selector === 'button[data-testid*="send"]') {
      return this.elements.filter((element) => element.tagName === 'BUTTON' && (element.getAttribute('data-testid') || '').includes('send'))
    }
    return []
  }
}

function evaluateChatGptExpression<T>(expression: string, document: FakeDocument): T {
  const previousGlobals = new Map<string, unknown>()
  for (const key of DOM_GLOBALS) {
    previousGlobals.set(key, (globalThis as Record<string, unknown>)[key])
  }

  Object.assign(globalThis, {
    document,
    HTMLElement: FakeHTMLElement,
    HTMLTextAreaElement: FakeHTMLTextAreaElement,
    HTMLButtonElement: FakeHTMLButtonElement,
    InputEvent: class {},
    getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }),
    location: { href: 'https://chatgpt.com/' },
  })

  try {
    return (0, eval)(expression) as T
  } finally {
    for (const key of DOM_GLOBALS) {
      const value = previousGlobals.get(key)
      if (typeof value === 'undefined') {
        delete (globalThis as Record<string, unknown>)[key]
      } else {
        ;(globalThis as Record<string, unknown>)[key] = value
      }
    }
  }
}

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

  it('uses a visible ProseMirror composer when legacy ChatGPT ids are absent', () => {
    const input = new FakeHTMLElement('div', {
      class: 'ProseMirror',
      contenteditable: 'true',
      role: 'textbox',
      'aria-label': 'Message ChatGPT',
    }, { x: 100, y: 700, width: 480, height: 44 })
    const sendButton = new FakeHTMLButtonElement('button', {
      'data-testid': 'send-button',
      'aria-label': 'Send prompt',
    }, { x: 540, y: 704, width: 44, height: 36 })
    const document = new FakeDocument([input, sendButton])

    const targetState = evaluateChatGptExpression<{
      visiblePrompt?: boolean
      promptSelector?: string
      visibleSubmit?: boolean
      submitSelector?: string
    }>(agentOSBrowserUseRunnerTestables.chatGptTargetStateExpression(), document)
    expect(targetState.visiblePrompt).toBe(true)
    expect(targetState.promptSelector).toBe('.ProseMirror[contenteditable="true"]')
    expect(targetState.visibleSubmit).toBe(true)
    expect(targetState.submitSelector).toBe('[data-testid="send-button"]')

    const prompt = 'Create an image of a fictional skyline.'
    const insertedLength = evaluateChatGptExpression<number>(
      agentOSBrowserUseRunnerTestables.chatGptSetPromptExpression(prompt),
      document,
    )
    expect(insertedLength).toBe(prompt.length)

    const promptState = evaluateChatGptExpression<{
      hasExpectedPrefix?: boolean
      buttonVisible?: boolean
      buttonDisabled?: boolean
    }>(agentOSBrowserUseRunnerTestables.chatGptPromptStateExpression('Create an image'), document)
    expect(promptState.hasExpectedPrefix).toBe(true)
    expect(promptState.buttonVisible).toBe(true)
    expect(promptState.buttonDisabled).toBe(false)

    expect(evaluateChatGptExpression<string>(agentOSBrowserUseRunnerTestables.chatGptSubmitExpression(), document)).toBe('https://chatgpt.com/')
    expect(sendButton.clicked).toBe(true)
  })

  it('maps missing ChatGPT input and submit diagnostics into worker snapshot fields', () => {
    const document = new FakeDocument([], 'ChatGPT')
    document.body.innerText = 'Sign in to ChatGPT before sending a message'

    const targetState = evaluateChatGptExpression<TestChatGptPromptState>(
      agentOSBrowserUseRunnerTestables.chatGptTargetStateExpression(),
      document,
    )
    expect(targetState.hasPrompt).toBe(false)
    expect(targetState.visiblePrompt).toBe(false)
    expect(targetState.hasSubmit).toBe(false)
    expect(targetState.visibleSubmit).toBe(false)
    expect(targetState.diagnostics).toContain('promptMatches=0')

    const snapshot = agentOSBrowserUseRunnerTestables.snapshotFromChatGptPromptState(targetState)
    expect(snapshot?.chatgpt?.inputFound).toBe(false)
    expect(snapshot?.chatgpt?.inputVisible).toBe(false)
    expect(snapshot?.chatgpt?.submitFound).toBe(false)
    expect(snapshot?.chatgpt?.submitVisible).toBe(false)
    expect(snapshot?.chatgpt?.diagnostics).toContain('sendButtons=0')

    const failureSnapshot = agentOSBrowserUseRunnerTestables.snapshotFromChatGptPromptFailure(
      new Error(`ChatGPT prompt input not found; ${targetState.diagnostics}`),
      'https://chatgpt.com/',
    )
    expect(failureSnapshot.chatgpt?.url).toBe('https://chatgpt.com/')
    expect(failureSnapshot.chatgpt?.inputFound).toBe(false)
    expect(failureSnapshot.chatgpt?.inputVisible).toBe(false)
    expect(failureSnapshot.chatgpt?.diagnostics).toContain('ChatGPT prompt input not found')
  })

  it('marks a missing or blocked ChatGPT submit button in failure snapshots', () => {
    const failureSnapshot = agentOSBrowserUseRunnerTestables.snapshotFromChatGptPromptFailure(
      new Error('ChatGPT send button is not ready; promptMatches=1; visibleEditable=1; sendButtons=0'),
      'https://chatgpt.com/',
    )

    expect(failureSnapshot.chatgpt?.submitFound).toBe(false)
    expect(failureSnapshot.chatgpt?.submitVisible).toBe(false)
    expect(failureSnapshot.chatgpt?.submitDisabled).toBe(true)
    expect(failureSnapshot.chatgpt?.diagnostics).toContain('sendButtons=0')
  })

  it('records a successful Brave CDP smoke snapshot', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'agentos-browser-smoke-'))
    tempDirs.push(storageDir)
    const worker = createAgentOSBrowserWorkerService({
      storageDir,
      enableHttp: false,
    })

    const result = await runAgentOSBraveChatGptSmoke({
      port: 9233,
      runId: 'smoke-ok',
      dependencies: {
        worker,
        listTargets: async () => [{
          id: 'chatgpt-target',
          title: 'ChatGPT',
          type: 'page',
          url: 'https://chatgpt.com/',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9233/devtools/page/chatgpt-target',
        }],
        inspectTarget: async () => ({
          url: 'https://chatgpt.com/',
          title: 'ChatGPT',
          hasPrompt: true,
          visiblePrompt: true,
          inputTextLength: 0,
          promptSelector: '#prompt-textarea',
          hasSubmit: true,
          visibleSubmit: true,
          submitDisabled: true,
          submitSelector: '#composer-submit-button',
          diagnostics: 'url=https://chatgpt.com/; title=ChatGPT; promptMatches=1; visibleEditable=1; sendButtons=1',
        }),
      },
    })

    expect(result.success).toBe(true)
    expect(result.target?.id).toBe('chatgpt-target')
    expect(result.chatgpt?.loginState).toBe('ready')
    expect(result.chatgpt?.promptSelector).toBe('#prompt-textarea')
    expect(result.chatgpt?.submitSelector).toBe('#composer-submit-button')

    const status = JSON.parse(await readFile(join(storageDir, 'latest-status.json'), 'utf-8'))
    expect(status.current.snapshot.chatgpt.loginState).toBe('ready')
    expect(status.current.snapshot.chatgpt.submitDisabled).toBe(true)

    const log = await readFile(join(storageDir, 'diagnostic-log.jsonl'), 'utf-8')
    expect(log).toContain('"phase":"browser_smoke"')
    expect(log).toContain('"status":"ok"')
  })

  it('keeps smoke default read-only and does not call E2E submit dependencies', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'agentos-browser-smoke-'))
    tempDirs.push(storageDir)
    const worker = createAgentOSBrowserWorkerService({
      storageDir,
      enableHttp: false,
    })
    const calls: string[] = []

    const result = await runAgentOSBraveChatGptSmoke({
      port: 9233,
      runId: 'smoke-read-only',
      dependencies: {
        worker,
        listTargets: async () => [{
          id: 'chatgpt-target',
          title: 'ChatGPT',
          type: 'page',
          url: 'https://chatgpt.com/',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9233/devtools/page/chatgpt-target',
        }],
        inspectTarget: async () => ({
          url: 'https://chatgpt.com/',
          title: 'ChatGPT',
          hasPrompt: true,
          visiblePrompt: true,
          inputTextLength: 0,
          promptSelector: '#prompt-textarea',
          hasSubmit: true,
          visibleSubmit: true,
          submitDisabled: false,
          submitSelector: '[data-testid="send-button"]',
          diagnostics: 'promptMatches=1; visibleEditable=1; sendButtons=1',
        }),
        submitPrompt: async () => {
          calls.push('submit')
          return 'https://chatgpt.com/c/should-not-happen'
        },
      },
    })

    expect(result.success).toBe(true)
    expect(calls).toEqual([])
  })

  it('runs explicit E2E submit, wait, and capture stages through injected dependencies', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'agentos-browser-e2e-'))
    tempDirs.push(storageDir)
    const worker = createAgentOSBrowserWorkerService({
      storageDir,
      enableHttp: false,
    })
    const calls: string[] = []

    const result = await runAgentOSBraveChatGptImageE2E({
      runId: 'e2e-ok',
      port: 9233,
      prompt: 'Create one fictional AgentOS validation image.',
      outputPath: join(storageDir, 'image.png'),
      submitTimeoutMs: 1_000,
      waitForImageMs: 1_000,
      dependencies: {
        worker,
        capability: {
          enabled: true,
          provider: 'brave',
          browserName: 'Brave Browser',
          executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
          profileDir: join(storageDir, 'profile'),
          remoteDebuggingPort: 9233,
          policy: 'read_only',
        },
        ensureBraveCdp: async () => {
          calls.push('connect')
          return 'reused'
        },
        submitPrompt: async () => {
          calls.push('submit')
          return 'https://chatgpt.com/c/e2e-ok'
        },
        waitForImage: async () => {
          calls.push('wait')
        },
        captureImage: async () => {
          calls.push('capture')
          return {
            width: 1024,
            height: 1024,
            method: 'brave_cdp_image_clip',
            evidencePath: join(storageDir, 'image.evidence.json'),
            screenshotPath: join(storageDir, 'image.evidence.png'),
            imageCandidateCount: 2,
          }
        },
      },
    })

    expect(result.success).toBe(true)
    expect(calls).toEqual(['connect', 'submit', 'wait', 'capture'])
    expect(result.conversationUrl).toBe('https://chatgpt.com/c/e2e-ok')
    expect(result.imagePath).toBe(join(storageDir, 'image.png'))
    expect(result.evidencePath).toContain('image.evidence.json')

    const status = JSON.parse(await readFile(join(storageDir, 'latest-status.json'), 'utf-8'))
    expect(status.current.snapshot.chatgpt.imageFound).toBe(true)
    expect(status.current.snapshot.chatgpt.imageCandidateCount).toBe(2)

    const log = await readFile(join(storageDir, 'diagnostic-log.jsonl'), 'utf-8')
    expect(log).toContain('"phase":"browser_connect"')
    expect(log).toContain('"phase":"browser_input"')
    expect(log).toContain('"phase":"browser_write"')
    expect(log).toContain('"phase":"browser_submit"')
    expect(log).toContain('"phase":"browser_wait"')
    expect(log).toContain('"phase":"browser_capture"')
    expect(log).toContain('"phase":"browser_success"')
  })

  it('records E2E timeout evidence paths when image capture fails', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'agentos-browser-e2e-'))
    tempDirs.push(storageDir)
    const worker = createAgentOSBrowserWorkerService({
      storageDir,
      enableHttp: false,
    })
    const evidencePath = join(storageDir, 'image.evidence.json')
    const screenshotPath = join(storageDir, 'image.evidence.png')

    const result = await runAgentOSBraveChatGptImageE2E({
      runId: 'e2e-timeout',
      port: 9233,
      prompt: 'Create one fictional AgentOS validation image.',
      outputPath: join(storageDir, 'image.png'),
      submitTimeoutMs: 1_000,
      waitForImageMs: 1_000,
      dependencies: {
        worker,
        capability: {
          enabled: true,
          provider: 'brave',
          browserName: 'Brave Browser',
          executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
          profileDir: join(storageDir, 'profile'),
          remoteDebuggingPort: 9233,
          policy: 'read_only',
        },
        ensureBraveCdp: async () => 'reused',
        submitPrompt: async () => 'https://chatgpt.com/c/e2e-timeout',
        waitForImage: async () => undefined,
        captureImage: async () => {
          const error = new Error('Timed out waiting for ChatGPT image') as Error & {
            evidencePath?: string
            screenshotPath?: string
            domSummary?: string
            imageCandidateCount?: number
          }
          error.evidencePath = evidencePath
          error.screenshotPath = screenshotPath
          error.domSummary = 'url=https://chatgpt.com/c/e2e-timeout; imageCandidates=0; body=Still generating'
          error.imageCandidateCount = 0
          throw error
        },
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Timed out waiting for ChatGPT image')
    expect(result.evidencePath).toBe(evidencePath)
    expect(result.screenshotPath).toBe(screenshotPath)
    expect(result.imageCandidateCount).toBe(0)

    const status = JSON.parse(await readFile(join(storageDir, 'latest-status.json'), 'utf-8'))
    expect(status.current.snapshot.chatgpt.evidencePath).toBe(evidencePath)
    expect(status.current.snapshot.chatgpt.screenshotPath).toBe(screenshotPath)
    expect(status.current.snapshot.chatgpt.diagnostics).toContain('imageCandidates=0')

    const log = await readFile(join(storageDir, 'diagnostic-log.jsonl'), 'utf-8')
    expect(log).toContain('"phase":"browser_failure"')
    expect(log).toContain('image.evidence.json')
  })

  it('fails smoke with explicit evidence when no ChatGPT CDP target exists', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'agentos-browser-smoke-'))
    tempDirs.push(storageDir)
    const worker = createAgentOSBrowserWorkerService({
      storageDir,
      enableHttp: false,
    })

    const result = await runAgentOSBraveChatGptSmoke({
      port: 9233,
      runId: 'smoke-no-target',
      dependencies: {
        worker,
        listTargets: async () => [{
          id: 'example-target',
          title: 'Example',
          type: 'page',
          url: 'https://example.com/',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9233/devtools/page/example-target',
        }],
        inspectTarget: async () => {
          throw new Error('inspectTarget should not be called without a ChatGPT target')
        },
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('No ChatGPT page target found')
    expect(result.diagnostics).toContain('Example <https://example.com/')
    expect(result.chatgpt?.inputFound).toBe(false)
    expect(result.chatgpt?.submitFound).toBe(false)

    const status = JSON.parse(await readFile(join(storageDir, 'latest-status.json'), 'utf-8'))
    expect(status.current.snapshot.chatgpt.diagnostics).toContain('No ChatGPT page target found')
    expect(status.current.snapshot.chatgpt.inputFound).toBe(false)

    const log = await readFile(join(storageDir, 'diagnostic-log.jsonl'), 'utf-8')
    expect(log).toContain('"phase":"browser_smoke"')
    expect(log).toContain('No ChatGPT page target found')
  })
})
