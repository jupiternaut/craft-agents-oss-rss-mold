import { afterEach, describe, expect, it } from 'bun:test'

import { agentOSBrowserUseRunnerTestables } from '../agentos-browser-use-runner'

const originalFetch = globalThis.fetch
const DOM_GLOBALS = ['document', 'HTMLElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'InputEvent', 'getComputedStyle', 'location'] as const

afterEach(() => {
  globalThis.fetch = originalFetch
})

type FakeRect = {
  x: number
  y: number
  width: number
  height: number
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
    }>(agentOSBrowserUseRunnerTestables.chatGptTargetStateExpression(), document)
    expect(targetState.visiblePrompt).toBe(true)
    expect(targetState.promptSelector).toBe('.ProseMirror[contenteditable="true"]')

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
})
