import { execFile } from 'node:child_process'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import WebSocket from 'ws'

import { resolveAgentOSBrowserUseCapability } from './agentos-browser-use'

const execFileAsync = promisify(execFile)

export type AgentOSBrowserUseRunResult = {
  success: boolean
  runId: string
  adapter: 'brave_macos_ui'
  prompt: string
  targetUrl: string
  conversationUrl?: string
  startedAt: string
  endedAt: string
  logPath?: string
  error?: string
}

export type AgentOSBrowserImageRunResult = AgentOSBrowserUseRunResult & {
  imagePath?: string
  imageWidth?: number
  imageHeight?: number
  captureMethod?: 'brave_cdp_image_download' | 'brave_cdp_image_clip'
}

type BrowserRunStatus = {
  phase: 'browser_prepare' | 'browser_prompt' | 'browser_waiting' | 'browser_capture' | 'browser_error'
  message: string
  detail?: string
}

type BrowserRunStatusEmitter = (status: BrowserRunStatus) => void

type BraveCdpTarget = {
  id: string
  title?: string
  url?: string
  type?: string
  webSocketDebuggerUrl?: string
}

type RuntimeEvaluateResult<T> = {
  result?: { value?: T }
  exceptionDetails?: {
    text?: string
    exception?: {
      description?: string
      value?: unknown
    }
  }
}

type ChatGptPromptState = {
  url: string
  title: string
  hasPrompt: boolean
  visiblePrompt: boolean
  inputTextLength: number
  promptSelector?: string
  diagnostics: string
}

type CdpImageRect = {
  x: number
  y: number
  width: number
  height: number
  naturalWidth: number
  naturalHeight: number
}

type CdpImageDownload = {
  base64: string
  mimeType: string
  naturalWidth: number
  naturalHeight: number
}

const CHATGPT_PROMPT_INPUT_SELECTORS = [
  '#prompt-textarea',
  '[data-testid="prompt-textarea"]',
  '[data-testid="composer-input"]',
  '[data-testid="composer"] [contenteditable="true"]',
  '.ProseMirror[contenteditable="true"]',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"][data-placeholder]',
  '[contenteditable="plaintext-only"]',
  'main [contenteditable="true"]',
  'textarea[aria-label*="Chat"]',
  'textarea[aria-label*="Message"]',
  'textarea[placeholder*="Message"]',
  'textarea',
]

const CHATGPT_SEND_BUTTON_SELECTORS = [
  '[data-testid="send-button"]',
  '#composer-submit-button',
  'button[aria-label*="Send"]',
  'button[data-testid*="send"]',
]

function quoteAppleScriptString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')}"`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isChatGptTargetUrl(url: string | undefined): boolean {
  if (!url) return false

  try {
    const hostname = new URL(url).hostname.toLocaleLowerCase()
    return hostname === 'chatgpt.com' || hostname.endsWith('.chatgpt.com')
  } catch {
    return url.includes('chatgpt.com')
  }
}

function summarizeCdpTargets(targets: BraveCdpTarget[]): string {
  const pageTargets = targets.filter((target) => target.type === 'page')
  if (pageTargets.length === 0) {
    return 'no page targets'
  }

  const preview = pageTargets
    .slice(0, 4)
    .map((target) => {
      const title = (target.title || 'untitled').replace(/\s+/g, ' ').slice(0, 48)
      const url = (target.url || 'about:blank').slice(0, 96)
      return `${title} <${url}>`
    })
    .join('; ')
  const extra = pageTargets.length > 4 ? `; +${pageTargets.length - 4} more` : ''
  return `${pageTargets.length} page target(s): ${preview}${extra}`
}

function launchBraveWithDebugging(args: {
  executablePath: string
  profileDir: string
  remoteDebuggingPort: number
  targetUrl: string
}): void {
  try {
    const child = execFile(args.executablePath, [
      `--remote-debugging-port=${args.remoteDebuggingPort}`,
      `--user-data-dir=${args.profileDir}`,
      '--no-first-run',
      args.targetUrl,
    ], {
      detached: true,
      stdio: 'ignore',
    } as any)
    child.unref()
  } catch {
    // AppleScript fallback below can still open the user's normal Brave window.
  }
}

async function waitForBraveCdp(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'Brave CDP is unavailable'

  while (Date.now() < deadline) {
    try {
      await listBraveCdpTargets(port)
      return
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await sleep(500)
    }
  }

  throw new Error(lastError)
}

async function ensureBraveCdp(args: {
  executablePath: string
  profileDir: string
  remoteDebuggingPort: number
  targetUrl: string
}): Promise<'reused' | 'launched'> {
  try {
    await listBraveCdpTargets(args.remoteDebuggingPort)
    return 'reused'
  } catch {
    launchBraveWithDebugging(args)
  }

  await waitForBraveCdp(args.remoteDebuggingPort, 20_000)
  return 'launched'
}

async function waitForBraveAppleEvents(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      await execFileAsync('/usr/bin/osascript', ['-e', 'tell application "Brave Browser" to activate'], {
        timeout: 3_000,
        maxBuffer: 128 * 1024,
      })
      return
    } catch (error) {
      lastError = error
      await sleep(1_000)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Brave Browser did not become available to AppleScript')
}

async function runAppleScriptWithBraveRetry(script: string, timeoutMs: number): Promise<string> {
  let lastError: unknown

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      })
      return stdout
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('Application isn’t running') && !message.includes("Application isn't running")) {
        break
      }
      await sleep(3_000)
      await waitForBraveAppleEvents(8_000)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Brave AppleScript run failed')
}

async function setMacClipboard(value: string): Promise<void> {
  await execFileAsync('/usr/bin/osascript', ['-e', `set the clipboard to ${quoteAppleScriptString(value)}`], {
    timeout: 3_000,
    maxBuffer: 128 * 1024,
  })
}

function bestImageExpression(): string {
  return `(() => {
    const images = Array.from(document.images)
      .filter((img) => img.complete && img.naturalWidth >= 384 && img.naturalHeight >= 384)
      .map((img) => {
        const rect = img.getBoundingClientRect();
        return { img, rect, area: img.naturalWidth * img.naturalHeight };
      })
      .filter((entry) => entry.rect.width >= 180 && entry.rect.height >= 180)
      .sort((a, b) => b.area - a.area);
    const winner = images[0];
    if (!winner) return null;
    winner.img.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = winner.img.getBoundingClientRect();
    return {
      x: Math.max(0, rect.left),
      y: Math.max(0, rect.top),
      width: Math.max(1, Math.min(rect.width, window.innerWidth - Math.max(0, rect.left))),
      height: Math.max(1, Math.min(rect.height, window.innerHeight - Math.max(0, rect.top))),
      naturalWidth: winner.img.naturalWidth,
      naturalHeight: winner.img.naturalHeight
    };
  })()`
}

function downloadBestImageExpression(): string {
  return `(async () => {
    const images = Array.from(document.images)
      .filter((img) => img.complete && img.naturalWidth >= 384 && img.naturalHeight >= 384)
      .map((img) => {
        const rect = img.getBoundingClientRect();
        return { img, rect, area: img.naturalWidth * img.naturalHeight };
      })
      .filter((entry) => entry.rect.width >= 180 && entry.rect.height >= 180)
      .sort((a, b) => b.area - a.area);
    const winner = images[0]?.img;
    if (!winner) return null;
    const src = winner.currentSrc || winner.src;
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) return null;
    const response = await fetch(src, { credentials: 'include' });
    if (!response.ok) throw new Error('image fetch failed: ' + response.status);
    const mimeType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return {
      base64: btoa(binary),
      mimeType,
      naturalWidth: winner.naturalWidth,
      naturalHeight: winner.naturalHeight
    };
  })()`
}

async function cdpSend<T>(
  socket: WebSocket,
  idCounter: { value: number },
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const id = ++idCounter.value
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error(`CDP command timed out: ${method}`))
    }, 10_000)
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const message = JSON.parse(raw.toString())
        if (message.id !== id) {
          return
        }
        clearTimeout(timeout)
        socket.off('message', onMessage)
        if (message.error) {
          reject(new Error(message.error.message || `CDP command failed: ${method}`))
          return
        }
        resolve(message.result as T)
      } catch (error) {
        clearTimeout(timeout)
        socket.off('message', onMessage)
        reject(error)
      }
    }
    socket.on('message', onMessage)
    socket.send(JSON.stringify({ id, method, params }))
  })
}

function readRuntimeEvaluateValue<T>(evaluation: RuntimeEvaluateResult<T> | undefined): T | undefined {
  if (evaluation?.exceptionDetails) {
    const exception = evaluation.exceptionDetails.exception
    const message = exception?.description || String(exception?.value || evaluation.exceptionDetails.text || 'ChatGPT page script failed')
    throw new Error(message.replace(/\s+/g, ' ').slice(0, 500))
  }

  return evaluation?.result?.value
}

async function withCdpTarget<T>(target: BraveCdpTarget, fn: (socket: WebSocket, idCounter: { value: number }) => Promise<T>): Promise<T> {
  if (!target.webSocketDebuggerUrl) {
    throw new Error('Brave CDP target has no websocket debugger URL')
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const idCounter = { value: 0 }
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })

  try {
    return await fn(socket, idCounter)
  } finally {
    socket.close()
  }
}

async function listBraveCdpTargets(port: number): Promise<BraveCdpTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) {
    throw new Error(`Brave CDP returned HTTP ${response.status}`)
  }
  return await response.json() as BraveCdpTarget[]
}

async function openBraveCdpTarget(port: number, url: string): Promise<BraveCdpTarget> {
  const endpoint = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`
  const putResponse = await fetch(endpoint, { method: 'PUT' }).catch(() => undefined)
  const response = putResponse?.ok ? putResponse : await fetch(endpoint)
  if (!response.ok) {
    throw new Error(`Brave CDP failed to open target: HTTP ${response.status}`)
  }
  return await response.json() as BraveCdpTarget
}

function chatGptPromptDomHelpersExpression(): string {
  return `
    const chatGptPromptInputSelectors = ${JSON.stringify(CHATGPT_PROMPT_INPUT_SELECTORS)};
    const chatGptSendButtonSelectors = ${JSON.stringify(CHATGPT_SEND_BUTTON_SELECTORS)};
    const chatGptElementVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 20 && rect.height > 10 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    };
    const chatGptInputText = (input) => input instanceof HTMLTextAreaElement
      ? input.value
      : (input.innerText || input.textContent || '');
    const chatGptFindPromptInput = () => {
      const seen = new Set();
      const candidates = [];
      for (const selector of chatGptPromptInputSelectors) {
        let nodes = [];
        try {
          nodes = Array.from(document.querySelectorAll(selector));
        } catch {}
        for (const node of nodes) {
          if (!(node instanceof HTMLElement) || seen.has(node)) continue;
          seen.add(node);
          const contentEditable = node.getAttribute('contenteditable');
          const editable = node instanceof HTMLTextAreaElement
            || node.isContentEditable
            || contentEditable === 'true'
            || contentEditable === 'plaintext-only';
          const disabled = node.getAttribute('aria-disabled') === 'true'
            || (node instanceof HTMLTextAreaElement && (node.disabled || node.readOnly));
          if (!editable || disabled || !chatGptElementVisible(node) || node.closest('[aria-hidden="true"]')) continue;
          candidates.push({ element: node, selector, rect: node.getBoundingClientRect() });
        }
      }
      candidates.sort((a, b) => {
        const aBottom = a.rect.top + a.rect.height;
        const bBottom = b.rect.top + b.rect.height;
        return bBottom - aBottom || (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height);
      });
      return candidates[0] || null;
    };
    const chatGptFindSendButton = () => {
      const seen = new Set();
      const candidates = [];
      for (const selector of chatGptSendButtonSelectors) {
        let nodes = [];
        try {
          nodes = Array.from(document.querySelectorAll(selector));
        } catch {}
        for (const node of nodes) {
          if (!(node instanceof HTMLElement) || seen.has(node)) continue;
          seen.add(node);
          if (!chatGptElementVisible(node) || node.closest('[aria-hidden="true"]')) continue;
          candidates.push({ element: node, selector, rect: node.getBoundingClientRect() });
        }
      }
      candidates.sort((a, b) => {
        const aBottom = a.rect.top + a.rect.height;
        const bBottom = b.rect.top + b.rect.height;
        return bBottom - aBottom || (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height);
      });
      return candidates[0] || null;
    };
    const chatGptPromptDiagnostics = () => {
      const visibleEditableCount = Array.from(document.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"], textarea'))
        .filter((node) => node instanceof HTMLElement && chatGptElementVisible(node)).length;
      const promptMatchCount = chatGptPromptInputSelectors.reduce((count, selector) => {
        try {
          return count + document.querySelectorAll(selector).length;
        } catch {
          return count;
        }
      }, 0);
      const buttonMatchCount = chatGptSendButtonSelectors.reduce((count, selector) => {
        try {
          return count + document.querySelectorAll(selector).length;
        } catch {
          return count;
        }
      }, 0);
      const bodyPreview = (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 220);
      return [
        'url=' + location.href,
        'title=' + document.title,
        'promptMatches=' + promptMatchCount,
        'visibleEditable=' + visibleEditableCount,
        'sendButtons=' + buttonMatchCount,
        bodyPreview ? 'body=' + bodyPreview : ''
      ].filter(Boolean).join('; ');
    };
  `
}

function chatGptTargetStateExpression(): string {
  return `(() => {
    ${chatGptPromptDomHelpersExpression()}
    const found = chatGptFindPromptInput();
    const input = found?.element;
    const text = input ? chatGptInputText(input) : '';
    return {
      url: location.href,
      title: document.title,
      hasPrompt: !!input,
      visiblePrompt: !!input,
      inputTextLength: text.trim().length,
      promptSelector: found?.selector,
      diagnostics: chatGptPromptDiagnostics()
    };
  })()`
}

async function waitForChatGptTarget(
  port: number,
  targetUrl: string,
  timeoutMs: number,
  onStatus?: BrowserRunStatusEmitter,
): Promise<BraveCdpTarget> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'No ChatGPT page target found'
  let openedChatGptTarget = false

  while (Date.now() < deadline) {
    try {
      const allTargets = await listBraveCdpTargets(port)
      const targets = allTargets
        .filter((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      const chatGptTargets = targets.filter((target) => isChatGptTargetUrl(target.url))
      for (const target of chatGptTargets) {
        try {
          const state = await withCdpTarget(target, async (socket, idCounter) => {
            const result = await cdpSend<RuntimeEvaluateResult<ChatGptPromptState>>(socket, idCounter, 'Runtime.evaluate', {
              expression: chatGptTargetStateExpression(),
              awaitPromise: false,
              returnByValue: true,
            })
            return readRuntimeEvaluateValue(result)
          })
          if (state?.visiblePrompt && !state.inputTextLength) {
            return target
          }
        } catch {
          // Try the next ChatGPT tab; stale targets are common while Brave is loading.
        }
      }
      if (chatGptTargets[0]) {
        return chatGptTargets[0]
      }

      lastError = `No ChatGPT page target found; CDP has ${summarizeCdpTargets(allTargets)}`
      if (!openedChatGptTarget) {
        openedChatGptTarget = true
        onStatus?.({
          phase: 'browser_prepare',
          message: '未发现 ChatGPT 页面，正在打开',
          detail: summarizeCdpTargets(allTargets),
        })
        const opened = await openBraveCdpTarget(port, targetUrl)
        if (opened.webSocketDebuggerUrl) {
          onStatus?.({
            phase: 'browser_prepare',
            message: '已创建 ChatGPT 页面目标',
            detail: opened.url || targetUrl,
          })
          return opened
        }
        lastError = `Opened ChatGPT target but debugger URL is missing; CDP has ${summarizeCdpTargets([...allTargets, opened])}`
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(1_000)
  }

  throw new Error(lastError)
}

function chatGptSubmitExpression(): string {
  return `(() => {
    ${chatGptPromptDomHelpersExpression()}
    const found = chatGptFindSendButton();
    const button = found?.element;
    if (!(button instanceof HTMLElement)) {
      throw new Error('ChatGPT send button not found; ' + chatGptPromptDiagnostics());
    }
    if (button.disabled === true || button.getAttribute('aria-disabled') === 'true') {
      throw new Error('ChatGPT send button is disabled');
    }
    button.click();
    return location.href;
  })()`
}

function chatGptPromptStateExpression(expectedPrefix = ''): string {
  return `(() => {
    ${chatGptPromptDomHelpersExpression()}
    const input = chatGptFindPromptInput()?.element;
    const button = chatGptFindSendButton()?.element;
    const expectedPrefix = ${JSON.stringify(expectedPrefix)};
    const text = input ? chatGptInputText(input) : '';
    return {
      textLength: text.trim().length,
      textPreview: text.trim().slice(0, 120),
      hasExpectedPrefix: expectedPrefix.length === 0 ? true : text.includes(expectedPrefix),
      buttonVisible: button instanceof HTMLElement ? !!(button.offsetWidth || button.offsetHeight || button.getClientRects().length) : false,
      buttonDisabled: button instanceof HTMLElement ? button.disabled === true || button.getAttribute('aria-disabled') === 'true' : true,
      diagnostics: chatGptPromptDiagnostics()
    };
  })()`
}

function chatGptSubmittedStateExpression(promptPrefix: string): string {
  return `(() => {
    ${chatGptPromptDomHelpersExpression()}
    const input = chatGptFindPromptInput()?.element;
    const body = document.body.innerText || '';
    const promptPrefix = ${JSON.stringify(promptPrefix)};
    const text = input ? chatGptInputText(input) : '';
    return {
      url: location.href,
      inputTextLength: text.trim().length,
      bodyHasPrompt: promptPrefix.length > 0 ? body.includes(promptPrefix) : false
    };
  })()`
}

function chatGptFocusPromptExpression(): string {
  return `(() => {
    ${chatGptPromptDomHelpersExpression()}
    const input = chatGptFindPromptInput()?.element;
    if (!(input instanceof HTMLElement)) {
      throw new Error('ChatGPT prompt input not found; ' + chatGptPromptDiagnostics());
    }
    input.focus();
    if (input instanceof HTMLTextAreaElement) {
      input.value = '';
    } else {
      document.execCommand('selectAll');
      if (!document.execCommand('delete')) {
        input.textContent = '';
      }
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    return true;
  })()`
}

function chatGptSetPromptExpression(prompt: string): string {
  return `(() => {
    const promptText = ${JSON.stringify(prompt)};
    ${chatGptPromptDomHelpersExpression()}
    const input = chatGptFindPromptInput()?.element;
    if (!(input instanceof HTMLElement)) {
      throw new Error('ChatGPT prompt input not found; ' + chatGptPromptDiagnostics());
    }
    input.focus();
    if (input instanceof HTMLTextAreaElement) {
      input.value = promptText;
    } else {
      document.execCommand('selectAll');
      document.execCommand('delete');
      const inserted = document.execCommand('insertText', false, promptText);
      if (!inserted) {
        input.innerHTML = '';
        const paragraph = document.createElement('p');
        paragraph.textContent = promptText;
        input.appendChild(paragraph);
      }
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: promptText }));
    return (input instanceof HTMLTextAreaElement ? input.value : (input.innerText || input.textContent || '')).trim().length;
  })()`
}

function chatGptPromptClickPointExpression(): string {
  return `(() => {
    ${chatGptPromptDomHelpersExpression()}
    const input = chatGptFindPromptInput()?.element;
    if (!(input instanceof HTMLElement)) {
      throw new Error('ChatGPT prompt input not found; ' + chatGptPromptDiagnostics());
    }
    const rect = input.getBoundingClientRect();
    return {
      x: Math.max(0, rect.left + Math.min(rect.width / 2, rect.width - 8)),
      y: Math.max(0, rect.top + Math.min(rect.height / 2, rect.height - 8))
    };
  })()`
}

async function waitForChatGptComposer(
  socket: WebSocket,
  idCounter: { value: number },
  timeoutMs: number,
  onStatus?: BrowserRunStatusEmitter,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'ChatGPT prompt input not found'
  let lastStatusAt = 0

  while (Date.now() < deadline) {
    try {
      const state = await cdpSend<RuntimeEvaluateResult<ChatGptPromptState>>(socket, idCounter, 'Runtime.evaluate', {
        expression: chatGptTargetStateExpression(),
        awaitPromise: false,
        returnByValue: true,
      })
      const promptState = readRuntimeEvaluateValue(state)
      if (promptState?.visiblePrompt) {
        return
      }
      if (promptState?.diagnostics) {
        lastError = `ChatGPT prompt input not found; ${promptState.diagnostics}`
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    if (onStatus && Date.now() - lastStatusAt > 5_000) {
      lastStatusAt = Date.now()
      onStatus({
        phase: 'browser_prompt',
        message: '等待 ChatGPT 输入框出现',
        detail: lastError,
      })
    }
    await sleep(500)
  }

  throw new Error(lastError)
}

async function submitChatGptPromptWithCdp(args: {
  port: number
  prompt: string
  targetUrl: string
  timeoutMs: number
  onStatus?: BrowserRunStatusEmitter
}): Promise<string | undefined> {
  const deadline = Date.now() + args.timeoutMs
  let lastError = 'No ChatGPT page target found'

  while (Date.now() < deadline) {
    try {
      const remainingMs = Math.max(1_000, deadline - Date.now())
      const target = await waitForChatGptTarget(
        args.port,
        args.targetUrl,
        Math.min(remainingMs, 20_000),
        args.onStatus,
      )
      args.onStatus?.({
        phase: 'browser_prompt',
        message: '已连接 ChatGPT 页面',
        detail: target.url || args.targetUrl,
      })
      return await withCdpTarget(target, async (socket, idCounter) => {
            await cdpSend(socket, idCounter, 'Page.enable')
            await cdpSend(socket, idCounter, 'Runtime.enable')
            await cdpSend(socket, idCounter, 'Page.bringToFront').catch(() => undefined)
            const initialState = readRuntimeEvaluateValue(await cdpSend<RuntimeEvaluateResult<ChatGptPromptState>>(socket, idCounter, 'Runtime.evaluate', {
              expression: chatGptTargetStateExpression(),
              awaitPromise: false,
              returnByValue: true,
            }))
            if (initialState?.visiblePrompt) {
              args.onStatus?.({
                phase: 'browser_prompt',
                message: '复用当前 ChatGPT 输入框',
                detail: `${initialState.title || initialState.url}${initialState.promptSelector ? ` · ${initialState.promptSelector}` : ''}`,
              })
            } else {
              args.onStatus?.({
                phase: 'browser_prompt',
                message: 'ChatGPT 页面未就绪，重新打开输入区',
                detail: initialState?.diagnostics || target.url || args.targetUrl,
              })
              await cdpSend(socket, idCounter, 'Page.navigate', { url: args.targetUrl }).catch(() => undefined)
              await sleep(1_500)
              await waitForChatGptComposer(socket, idCounter, Math.min(Math.max(10_000, deadline - Date.now()), 90_000), args.onStatus)
            }
            readRuntimeEvaluateValue(await cdpSend<RuntimeEvaluateResult<boolean>>(socket, idCounter, 'Runtime.evaluate', {
              expression: chatGptFocusPromptExpression(),
              awaitPromise: false,
              returnByValue: true,
            }))
            const point = readRuntimeEvaluateValue(await cdpSend<RuntimeEvaluateResult<{ x?: number; y?: number }>>(socket, idCounter, 'Runtime.evaluate', {
              expression: chatGptPromptClickPointExpression(),
              awaitPromise: false,
              returnByValue: true,
            }))
            const x = point?.x
            const y = point?.y
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
              throw new Error('ChatGPT prompt input coordinates unavailable')
            }
            await cdpSend(socket, idCounter, 'Input.dispatchMouseEvent', {
              type: 'mouseMoved',
              x,
              y,
              button: 'none',
            })
            await cdpSend(socket, idCounter, 'Input.dispatchMouseEvent', {
              type: 'mousePressed',
              x,
              y,
              button: 'left',
              clickCount: 1,
            })
            await cdpSend(socket, idCounter, 'Input.dispatchMouseEvent', {
              type: 'mouseReleased',
              x,
              y,
              button: 'left',
              clickCount: 1,
            })
            readRuntimeEvaluateValue(await cdpSend<RuntimeEvaluateResult<number>>(socket, idCounter, 'Runtime.evaluate', {
              expression: chatGptSetPromptExpression(args.prompt),
              awaitPromise: false,
              returnByValue: true,
            }))
            await sleep(750)
            const promptPrefix = args.prompt.trim().slice(0, 80)
            let state = await cdpSend<RuntimeEvaluateResult<{ textLength?: number; textPreview?: string; hasExpectedPrefix?: boolean; buttonVisible?: boolean; buttonDisabled?: boolean; diagnostics?: string }>>(socket, idCounter, 'Runtime.evaluate', {
              expression: chatGptPromptStateExpression(promptPrefix),
              awaitPromise: false,
              returnByValue: true,
            })
            let promptState = readRuntimeEvaluateValue(state)
            if (!promptState?.textLength || promptState.textLength < 10 || !promptState.hasExpectedPrefix || promptState.buttonDisabled) {
              await setMacClipboard(args.prompt)
              readRuntimeEvaluateValue(await cdpSend<RuntimeEvaluateResult<boolean>>(socket, idCounter, 'Runtime.evaluate', {
                expression: chatGptFocusPromptExpression(),
                awaitPromise: false,
                returnByValue: true,
              }))
              await cdpSend(socket, idCounter, 'Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x,
                y,
                button: 'left',
                clickCount: 1,
              })
              await cdpSend(socket, idCounter, 'Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x,
                y,
                button: 'left',
                clickCount: 1,
              })
              await cdpSend(socket, idCounter, 'Input.dispatchKeyEvent', {
                type: 'rawKeyDown',
                key: 'v',
                code: 'KeyV',
                windowsVirtualKeyCode: 86,
                nativeVirtualKeyCode: 9,
                modifiers: 4,
              })
              await cdpSend(socket, idCounter, 'Input.dispatchKeyEvent', {
                type: 'keyUp',
                key: 'v',
                code: 'KeyV',
                windowsVirtualKeyCode: 86,
                nativeVirtualKeyCode: 9,
                modifiers: 4,
              })
              await sleep(1_500)
              state = await cdpSend<RuntimeEvaluateResult<{ textLength?: number; textPreview?: string; hasExpectedPrefix?: boolean; buttonVisible?: boolean; buttonDisabled?: boolean; diagnostics?: string }>>(socket, idCounter, 'Runtime.evaluate', {
                expression: chatGptPromptStateExpression(promptPrefix),
                awaitPromise: false,
                returnByValue: true,
              })
              promptState = readRuntimeEvaluateValue(state)
            }
            if (!promptState?.textLength || promptState.textLength < 10 || !promptState.hasExpectedPrefix) {
              throw new Error(`ChatGPT prompt text was not inserted${promptState?.textPreview ? `; saw: ${promptState.textPreview}` : ''}${promptState?.diagnostics ? `; ${promptState.diagnostics}` : ''}`)
            }
            if (!promptState.buttonVisible || promptState.buttonDisabled) {
              throw new Error(`ChatGPT send button is not ready${promptState.diagnostics ? `; ${promptState.diagnostics}` : ''}`)
            }
            const submitted = await cdpSend<RuntimeEvaluateResult<string>>(socket, idCounter, 'Runtime.evaluate', {
              expression: chatGptSubmitExpression(),
              awaitPromise: false,
              returnByValue: true,
            })
            const submitDeadline = Date.now() + 20_000
            let latestUrl = readRuntimeEvaluateValue(submitted)
            while (Date.now() < submitDeadline) {
              await sleep(1_000)
              const locationResult = await cdpSend<RuntimeEvaluateResult<{ url?: string; inputTextLength?: number; bodyHasPrompt?: boolean }>>(socket, idCounter, 'Runtime.evaluate', {
                expression: chatGptSubmittedStateExpression(promptPrefix),
                awaitPromise: false,
                returnByValue: true,
              }).catch(() => undefined)
              const submittedState = readRuntimeEvaluateValue(locationResult)
              latestUrl = submittedState?.url || latestUrl
              if (submittedState?.bodyHasPrompt && (submittedState.url?.includes('/c/') || submittedState.inputTextLength === 0)) {
                return submittedState.url
              }
            }

            throw new Error(`ChatGPT prompt was not submitted${latestUrl ? `; current URL: ${latestUrl}` : ''}`)
      })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await sleep(1_000)
  }

  throw new Error(lastError)
}

async function captureLatestChatGptImageFromBrave(args: {
  port: number
  outputPath: string
  timeoutMs: number
  preferredUrl?: string
}): Promise<{ width: number; height: number; method: 'brave_cdp_image_download' | 'brave_cdp_image_clip' }> {
  const deadline = Date.now() + args.timeoutMs
  let lastError = 'No ChatGPT image target found'

  while (Date.now() < deadline) {
    try {
      const targets = (await listBraveCdpTargets(args.port))
        .filter((target) => target.type === 'page' && target.webSocketDebuggerUrl && isChatGptTargetUrl(target.url))
        .sort((left, right) => {
          const leftPreferred = args.preferredUrl && left.url === args.preferredUrl
          const rightPreferred = args.preferredUrl && right.url === args.preferredUrl
          if (leftPreferred !== rightPreferred) {
            return leftPreferred ? -1 : 1
          }
          return 0
        })

      for (const target of targets) {
        try {
          const captured = await withCdpTarget(target, async (socket, idCounter) => {
            await cdpSend(socket, idCounter, 'Page.enable')
            await cdpSend(socket, idCounter, 'Runtime.evaluate', {
              expression: bestImageExpression(),
              awaitPromise: false,
              returnByValue: true,
            })
            await sleep(500)
            const rectResult = await cdpSend<{ result?: { value?: CdpImageRect | null } }>(socket, idCounter, 'Runtime.evaluate', {
              expression: bestImageExpression(),
              awaitPromise: false,
              returnByValue: true,
            })
            const rect = rectResult.result?.value
            if (!rect || rect.width < 180 || rect.height < 180) {
              throw new Error('Generated image is not visible yet')
            }
            const download = await cdpSend<{ result?: { value?: CdpImageDownload | null } }>(socket, idCounter, 'Runtime.evaluate', {
              expression: downloadBestImageExpression(),
              awaitPromise: true,
              returnByValue: true,
            }).catch(() => null)
            const downloadedImage = download?.result?.value
            if (downloadedImage?.base64) {
              await writeFile(args.outputPath, Buffer.from(downloadedImage.base64, 'base64'))
              return {
                width: Math.round(downloadedImage.naturalWidth),
                height: Math.round(downloadedImage.naturalHeight),
                method: 'brave_cdp_image_download' as const,
              }
            }

            const screenshot = await cdpSend<{ data: string }>(socket, idCounter, 'Page.captureScreenshot', {
              format: 'png',
              clip: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                scale: 1,
              },
            })
            await writeFile(args.outputPath, Buffer.from(screenshot.data, 'base64'))
            return {
              width: Math.round(rect.naturalWidth || rect.width),
              height: Math.round(rect.naturalHeight || rect.height),
              method: 'brave_cdp_image_clip' as const,
            }
          })
          return captured
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await sleep(3_000)
  }

  throw new Error(lastError)
}

export const agentOSBrowserUseRunnerTestables = {
  chatGptPromptStateExpression,
  chatGptSetPromptExpression,
  chatGptSubmitExpression,
  chatGptTargetStateExpression,
  isChatGptTargetUrl,
  summarizeCdpTargets,
  waitForChatGptTarget,
}

async function appendBrowserRunLog(record: AgentOSBrowserUseRunResult): Promise<string | undefined> {
  try {
    const logDir = join(homedir(), '.craft-agent', 'agentos')
    const logPath = join(logDir, 'browser-runs.jsonl')
    await mkdir(logDir, { recursive: true })
    await appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf-8')
    return logPath
  } catch {
    return undefined
  }
}

function buildBraveChatGptAppleScript(args: {
  prompt: string
  targetUrl: string
  clickX: number
  clickY: number
}): string {
  return [
    `set targetUrl to ${quoteAppleScriptString(args.targetUrl)}`,
    `set promptText to ${quoteAppleScriptString(args.prompt)}`,
    '',
    'tell application "Brave Browser"',
    '  activate',
    '  open location targetUrl',
    'end tell',
    'delay 4',
    '',
    'tell application "System Events"',
    '  tell process "Brave Browser"',
    '    set frontmost to true',
    '    keystroke "o" using {command down, shift down}',
    '  end tell',
    'end tell',
    'delay 2',
    '',
    'set the clipboard to promptText',
    'tell application "System Events"',
    '  tell process "Brave Browser"',
    `    click at {${Math.round(args.clickX)}, ${Math.round(args.clickY)}}`,
    '    delay 0.3',
    '    keystroke "v" using {command down}',
    '    delay 0.4',
    '    keystroke return',
    '  end tell',
    'end tell',
    'delay 2',
    '',
    'tell application "Brave Browser"',
    '  return URL of active tab of front window',
    'end tell',
  ].join('\n')
}

export async function runAgentOSBraveChatGptPrompt(args: {
  prompt: string
  targetUrl?: string
  timeoutMs?: number
  clickX?: number
  clickY?: number
  onStatus?: BrowserRunStatusEmitter
}): Promise<AgentOSBrowserUseRunResult> {
  const runId = `agentos-browser-${Date.now()}`
  const startedAt = new Date().toISOString()
  const targetUrl = args.targetUrl || 'https://chatgpt.com/'
  const capability = resolveAgentOSBrowserUseCapability()

  if (!capability.enabled) {
    const failed: AgentOSBrowserUseRunResult = {
      success: false,
      runId,
      adapter: 'brave_macos_ui',
      prompt: args.prompt,
      targetUrl,
      startedAt,
      endedAt: new Date().toISOString(),
      error: capability.reason || 'AgentOS Browser Use is unavailable',
    }
    failed.logPath = await appendBrowserRunLog(failed)
    return failed
  }

  try {
    args.onStatus?.({
      phase: 'browser_prepare',
      message: '检查 Brave 和 ChatGPT 页面',
      detail: `CDP 端口 ${capability.remoteDebuggingPort}`,
    })
    const braveState = await ensureBraveCdp({
      executablePath: capability.executablePath,
      profileDir: capability.profileDir,
      remoteDebuggingPort: capability.remoteDebuggingPort,
      targetUrl,
    })
    args.onStatus?.({
      phase: 'browser_prepare',
      message: braveState === 'reused' ? '复用已打开的 Brave' : '已打开 Brave',
      detail: '下一步把准备好的图片提示词写入 ChatGPT。',
    })
    await waitForBraveAppleEvents(12_000).catch(() => undefined)
    args.onStatus?.({
      phase: 'browser_prompt',
      message: '正在写入 ChatGPT 提示词',
      detail: `提示词 ${args.prompt.length} 字符`,
    })
    const conversationUrl = await submitChatGptPromptWithCdp({
      port: capability.remoteDebuggingPort,
      prompt: args.prompt,
      targetUrl,
      timeoutMs: args.timeoutMs ?? 120_000,
      onStatus: args.onStatus,
    })
    args.onStatus?.({
      phase: 'browser_waiting',
      message: '图片提示词已提交',
      detail: conversationUrl || targetUrl,
    })
    const record: AgentOSBrowserUseRunResult = {
      success: true,
      runId,
      adapter: 'brave_macos_ui',
      prompt: args.prompt,
      targetUrl,
      conversationUrl,
      startedAt,
      endedAt: new Date().toISOString(),
    }
    record.logPath = await appendBrowserRunLog(record)
    return record
  } catch (error) {
    args.onStatus?.({
      phase: 'browser_error',
      message: 'Brave/ChatGPT 提示词提交失败',
      detail: error instanceof Error ? error.message : String(error),
    })
    const record: AgentOSBrowserUseRunResult = {
      success: false,
      runId,
      adapter: 'brave_macos_ui',
      prompt: args.prompt,
      targetUrl,
      startedAt,
      endedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }
    record.logPath = await appendBrowserRunLog(record)
    return record
  }
}

export async function runAgentOSBraveChatGptImagePrompt(args: {
  prompt: string
  outputPath: string
  targetUrl?: string
  timeoutMs?: number
  waitForImageMs?: number
  clickX?: number
  clickY?: number
  onStatus?: BrowserRunStatusEmitter
}): Promise<AgentOSBrowserImageRunResult> {
  const capability = resolveAgentOSBrowserUseCapability()
  const promptResult = await runAgentOSBraveChatGptPrompt({
    prompt: args.prompt,
    targetUrl: args.targetUrl,
    timeoutMs: args.timeoutMs,
    clickX: args.clickX,
    clickY: args.clickY,
    onStatus: args.onStatus,
  })

  if (!promptResult.success) {
    return promptResult
  }

  if (!capability.enabled) {
    return {
      ...promptResult,
      success: false,
      error: capability.reason || 'AgentOS Browser Use is unavailable',
    }
  }

  try {
    await mkdir(join(args.outputPath, '..'), { recursive: true })
    args.onStatus?.({
      phase: 'browser_waiting',
      message: '等待 ChatGPT 图片出现在页面里',
      detail: `最多等待 ${Math.round((args.waitForImageMs ?? 300_000) / 1000)} 秒`,
    })
    const image = await captureLatestChatGptImageFromBrave({
      port: capability.remoteDebuggingPort,
      outputPath: args.outputPath,
      timeoutMs: args.waitForImageMs ?? 300_000,
      preferredUrl: promptResult.conversationUrl,
    })
    args.onStatus?.({
      phase: 'browser_capture',
      message: '已捕获 ChatGPT 图片',
      detail: args.outputPath,
    })
    const record: AgentOSBrowserImageRunResult = {
      ...promptResult,
      imagePath: args.outputPath,
      imageWidth: image.width,
      imageHeight: image.height,
      captureMethod: image.method,
    }
    record.logPath = await appendBrowserRunLog(record)
    return record
  } catch (error) {
    args.onStatus?.({
      phase: 'browser_error',
      message: '图片生成或捕获失败',
      detail: error instanceof Error ? error.message : String(error),
    })
    const record: AgentOSBrowserImageRunResult = {
      ...promptResult,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
    record.logPath = await appendBrowserRunLog(record)
    return record
  }
}
