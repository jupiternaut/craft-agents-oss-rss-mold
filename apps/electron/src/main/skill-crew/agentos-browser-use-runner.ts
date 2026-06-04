import { execFile } from 'node:child_process'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { promisify } from 'node:util'

import WebSocket from 'ws'

import { getAgentOSBrowserWorker, type AgentOSBrowserWorkerEventStatus, type AgentOSBrowserWorkerService, type AgentOSBrowserWorkerSnapshot } from './agentos-browser-worker'
import { resolveAgentOSBrowserUseCapability, type AgentOSBrowserUseCapability } from './agentos-browser-use'

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

export type AgentOSBrowserSmokeResult = {
  success: boolean
  runId: string
  adapter: 'brave_cdp_smoke'
  targetUrl: string
  port: number
  startedAt: string
  endedAt: string
  targetSummary: string
  target?: AgentOSBrowserWorkerSnapshot['target']
  chatgpt?: AgentOSBrowserWorkerSnapshot['chatgpt']
  diagnostics: string
  workerStatusUrl?: string
  error?: string
}

export type AgentOSBrowserImageE2EPhase =
  | 'browser_connect'
  | 'browser_input'
  | 'browser_write'
  | 'browser_submit'
  | 'browser_wait'
  | 'browser_capture'
  | 'browser_success'
  | 'browser_failure'

export type AgentOSBrowserImageE2EStatus = {
  phase: AgentOSBrowserImageE2EPhase
  status?: AgentOSBrowserWorkerEventStatus
  message: string
  detail?: string
  workerNarration?: string
  failureEvidence?: string
  domSummary?: string
  debugUrl?: string
  snapshot?: Partial<AgentOSBrowserWorkerSnapshot>
}

export type AgentOSBrowserImageE2EResult = {
  success: boolean
  runId: string
  adapter: 'brave_cdp_image_e2e'
  prompt: string
  targetUrl: string
  port: number
  outputPath: string
  conversationUrl?: string
  imagePath?: string
  imageWidth?: number
  imageHeight?: number
  captureMethod?: 'brave_cdp_image_download' | 'brave_cdp_image_clip'
  startedAt: string
  endedAt: string
  diagnostics: string
  workerStatusUrl?: string
  logPath?: string
  evidencePath?: string
  screenshotPath?: string
  imageCandidateCount?: number
  error?: string
}

type BrowserRunStatus = {
  phase: 'browser_prepare' | 'browser_prompt' | 'browser_waiting' | 'browser_capture' | 'browser_error'
  message: string
  detail?: string
  workerNarration?: string
  failureEvidence?: string
  domSummary?: string
  debugUrl?: string
  snapshot?: Partial<AgentOSBrowserWorkerSnapshot>
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
  hasSubmit?: boolean
  visibleSubmit?: boolean
  submitDisabled?: boolean
  submitSelector?: string
  diagnostics: string
}

type AgentOSBrowserSmokeDependencies = {
  worker?: AgentOSBrowserWorkerService
  listTargets?: (port: number) => Promise<BraveCdpTarget[]>
  inspectTarget?: (target: BraveCdpTarget) => Promise<ChatGptPromptState | undefined>
  capability?: AgentOSBrowserUseCapability
  ensureBraveCdp?: typeof ensureBraveCdp
  submitPrompt?: (args: {
    port: number
    prompt: string
    targetUrl: string
    timeoutMs: number
    onStatus?: BrowserRunStatusEmitter
  }) => Promise<string | undefined>
  waitForImage?: (args: {
    port: number
    outputPath: string
    timeoutMs: number
    preferredUrl?: string
    onStatus?: BrowserRunStatusEmitter
  }) => Promise<void>
  captureImage?: (args: {
    port: number
    outputPath: string
    timeoutMs: number
    preferredUrl?: string
    onStatus?: BrowserRunStatusEmitter
  }) => Promise<CapturedChatGptImage>
}

type CdpImageRect = {
  x: number
  y: number
  width: number
  height: number
  naturalWidth: number
  naturalHeight: number
}

type CapturedChatGptImage = {
  width: number
  height: number
  method: 'brave_cdp_image_download' | 'brave_cdp_image_clip'
  evidencePath?: string
  screenshotPath?: string
  imageCandidateCount?: number
}

type ChatGptImagePageEvidence = {
  url: string
  title: string
  bodyPreview?: string
  imageCandidateCount: number
  imageCandidates: Array<{
    srcPreview?: string
    alt?: string
    naturalWidth: number
    naturalHeight: number
    rectWidth: number
    rectHeight: number
  }>
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

function summarizeChatGptPromptState(state: ChatGptPromptState | undefined): string | undefined {
  if (!state) return undefined
  return [
    `url=${state.url}`,
    `title=${state.title || 'untitled'}`,
    `input=${state.visiblePrompt ? 'found' : 'missing'}`,
    state.promptSelector ? `inputSelector=${state.promptSelector}` : undefined,
    `inputText=${state.inputTextLength}`,
    `submit=${state.visibleSubmit ? 'found' : 'missing'}`,
    state.submitSelector ? `submitSelector=${state.submitSelector}` : undefined,
    state.submitDisabled ? 'submit=disabled' : undefined,
    state.diagnostics,
  ].filter(Boolean).join('; ')
}

function targetSnapshot(target: BraveCdpTarget | undefined): AgentOSBrowserWorkerSnapshot['target'] | undefined {
  if (!target) return undefined
  return {
    id: target.id,
    url: target.url,
    title: target.title,
  }
}

function imageEvidencePathForOutput(outputPath: string, suffix: string): string {
  const extension = extname(outputPath)
  if (!extension) return `${outputPath}${suffix}`
  return `${outputPath.slice(0, -extension.length)}${suffix}`
}

function summarizeImageEvidence(evidence: ChatGptImagePageEvidence | undefined): string | undefined {
  if (!evidence) return undefined
  const largest = evidence.imageCandidates[0]
  return [
    `url=${evidence.url}`,
    `title=${evidence.title || 'untitled'}`,
    `imageCandidates=${evidence.imageCandidateCount}`,
    largest ? `largest=${largest.naturalWidth}x${largest.naturalHeight}/${Math.round(largest.rectWidth)}x${Math.round(largest.rectHeight)}` : undefined,
    evidence.bodyPreview ? `body=${evidence.bodyPreview}` : undefined,
  ].filter(Boolean).join('; ')
}

async function persistImageEvidence(args: {
  outputPath: string
  target?: BraveCdpTarget
  evidence?: ChatGptImagePageEvidence
  error?: string
}): Promise<string | undefined> {
  try {
    const evidencePath = imageEvidencePathForOutput(args.outputPath, '.evidence.json')
    await mkdir(dirname(evidencePath), { recursive: true })
    await writeFile(evidencePath, `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      target: targetSnapshot(args.target),
      error: args.error,
      evidence: args.evidence,
    }, null, 2)}\n`, 'utf-8')
    return evidencePath
  } catch {
    return undefined
  }
}

function enrichImageCaptureError(error: unknown, extra: {
  evidencePath?: string
  screenshotPath?: string
  domSummary?: string
  imageCandidateCount?: number
}): Error {
  const message = error instanceof Error ? error.message : String(error)
  const enriched = new Error(message) as Error & {
    evidencePath?: string
    screenshotPath?: string
    domSummary?: string
    imageCandidateCount?: number
  }
  enriched.evidencePath = extra.evidencePath
  enriched.screenshotPath = extra.screenshotPath
  enriched.domSummary = extra.domSummary
  enriched.imageCandidateCount = extra.imageCandidateCount
  return enriched
}

function imageCaptureErrorSnapshot(error: unknown, targetUrl: string, outputPath: string): Partial<AgentOSBrowserWorkerSnapshot> {
  const enriched = error as {
    evidencePath?: string
    screenshotPath?: string
    domSummary?: string
    imageCandidateCount?: number
  }
  const diagnostics = error instanceof Error ? error.message : String(error)
  return {
    targetUrl,
    chatgpt: {
      url: targetUrl,
      imageFound: false,
      capturePath: outputPath,
      evidencePath: enriched.evidencePath,
      screenshotPath: enriched.screenshotPath,
      imageCandidateCount: enriched.imageCandidateCount,
      diagnostics: enriched.domSummary || diagnostics,
    },
  }
}

function snapshotFromChatGptPromptState(state: ChatGptPromptState | undefined): Partial<AgentOSBrowserWorkerSnapshot> | undefined {
  if (!state) return undefined
  return {
    chatgpt: {
      url: state.url,
      title: state.title,
      loginState: state.visiblePrompt ? 'ready' : 'not_ready',
      inputFound: state.hasPrompt,
      inputVisible: state.visiblePrompt,
      inputTextLength: state.inputTextLength,
      promptSelector: state.promptSelector,
      submitFound: state.hasSubmit,
      submitVisible: state.visibleSubmit,
      submitDisabled: state.submitDisabled,
      submitSelector: state.submitSelector,
      diagnostics: state.diagnostics,
    },
  }
}

function smokeSnapshot(args: {
  targetUrl: string
  target?: BraveCdpTarget
  state?: ChatGptPromptState
  diagnostics: string
}): Partial<AgentOSBrowserWorkerSnapshot> {
  const stateSnapshot = snapshotFromChatGptPromptState(args.state)
  return {
    targetUrl: args.targetUrl,
    target: targetSnapshot(args.target),
    chatgpt: {
      url: args.state?.url || args.target?.url || args.targetUrl,
      title: args.state?.title || args.target?.title,
      loginState: args.state?.visiblePrompt ? 'ready' : 'not_ready',
      inputFound: args.state ? args.state.hasPrompt : false,
      inputVisible: args.state ? args.state.visiblePrompt : false,
      inputTextLength: args.state?.inputTextLength,
      promptSelector: args.state?.promptSelector,
      submitFound: args.state ? args.state.hasSubmit : false,
      submitVisible: args.state ? args.state.visibleSubmit : false,
      submitDisabled: args.state?.submitDisabled,
      submitSelector: args.state?.submitSelector,
      diagnostics: args.diagnostics || stateSnapshot?.chatgpt?.diagnostics,
    },
  }
}

function snapshotFromChatGptPromptFailure(
  error: unknown,
  targetUrl: string,
): Partial<AgentOSBrowserWorkerSnapshot> {
  const diagnostics = error instanceof Error ? error.message : String(error)
  const promptMissing = /prompt input not found|prompt text was not inserted|input not found/i.test(diagnostics)
  const submitMissing = /send button not found|send button is not ready|send button is disabled|prompt was not submitted/i.test(diagnostics)

  return {
    targetUrl,
    chatgpt: {
      url: targetUrl,
      loginState: 'not_ready',
      inputFound: promptMissing ? false : undefined,
      inputVisible: promptMissing ? false : undefined,
      submitFound: submitMissing ? false : undefined,
      submitVisible: submitMissing ? false : undefined,
      submitDisabled: /disabled|not ready/i.test(diagnostics) ? true : undefined,
      diagnostics,
    },
  }
}

function workerStatusFromBrowserPhase(phase: BrowserRunStatus['phase']): AgentOSBrowserWorkerEventStatus {
  if (phase === 'browser_error') return 'error'
  if (phase === 'browser_capture') return 'ok'
  return 'info'
}

function emitBrowserRunStatus(
  runId: string,
  onStatus: BrowserRunStatusEmitter | undefined,
  status: BrowserRunStatus,
): void {
  const worker = getAgentOSBrowserWorker()
  const debugUrl = status.debugUrl ?? worker.getStatusUrl()
  onStatus?.({
    ...status,
    debugUrl,
  })
  void worker.record({
    runId,
    phase: status.phase,
    status: workerStatusFromBrowserPhase(status.phase),
    message: status.workerNarration || status.message,
    detail: status.detail,
    evidence: status.failureEvidence,
    snapshot: status.snapshot,
  })
}

function workerStatusFromImageE2EPhase(phase: AgentOSBrowserImageE2EPhase): AgentOSBrowserWorkerEventStatus {
  if (phase === 'browser_failure') return 'error'
  if (phase === 'browser_success' || phase === 'browser_capture') return 'ok'
  return 'info'
}

async function recordImageE2EStatus(args: {
  worker: AgentOSBrowserWorkerService
  runId: string
  onStatus?: (status: AgentOSBrowserImageE2EStatus) => void
  status: AgentOSBrowserImageE2EStatus
}): Promise<void> {
  const debugUrl = args.status.debugUrl ?? args.worker.getStatusUrl()
  const status = {
    ...args.status,
    debugUrl,
    status: args.status.status ?? workerStatusFromImageE2EPhase(args.status.phase),
  }
  args.onStatus?.(status)
  await args.worker.record({
    runId: args.runId,
    phase: status.phase,
    status: status.status,
    message: status.workerNarration || status.message,
    detail: status.detail,
    evidence: status.failureEvidence,
    snapshot: status.snapshot,
  })
}

function mapBrowserRunStatusToImageE2E(status: BrowserRunStatus): AgentOSBrowserImageE2EStatus {
  let phase: AgentOSBrowserImageE2EPhase
  if (status.phase === 'browser_prepare') {
    phase = 'browser_connect'
  } else if (status.phase === 'browser_waiting') {
    phase = 'browser_wait'
  } else if (status.phase === 'browser_capture') {
    phase = 'browser_capture'
  } else if (status.phase === 'browser_error') {
    phase = 'browser_failure'
  } else if (/写入|粘贴|校验/.test(status.message)) {
    phase = 'browser_write'
  } else if (/点击|发送|提交|接受/.test(status.message)) {
    phase = 'browser_submit'
  } else {
    phase = 'browser_input'
  }

  return {
    phase,
    message: status.message,
    detail: status.detail,
    workerNarration: status.workerNarration,
    failureEvidence: status.failureEvidence,
    domSummary: status.domSummary,
    debugUrl: status.debugUrl,
    snapshot: status.snapshot,
  }
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

function imageEvidenceExpression(): string {
  return `(() => {
    const imageCandidates = Array.from(document.images)
      .map((img) => {
        const rect = img.getBoundingClientRect();
        const src = img.currentSrc || img.src || '';
        return {
          srcPreview: src.slice(0, 180),
          alt: (img.getAttribute('alt') || '').slice(0, 120),
          naturalWidth: img.naturalWidth || 0,
          naturalHeight: img.naturalHeight || 0,
          rectWidth: Math.round(rect.width || 0),
          rectHeight: Math.round(rect.height || 0)
        };
      })
      .filter((candidate) => candidate.naturalWidth > 0 || candidate.naturalHeight > 0 || candidate.rectWidth > 0 || candidate.rectHeight > 0)
      .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight))
      .slice(0, 12);
    return {
      url: location.href,
      title: document.title,
      bodyPreview: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 360),
      imageCandidateCount: imageCandidates.length,
      imageCandidates
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

async function inspectChatGptTargetPromptState(target: BraveCdpTarget): Promise<ChatGptPromptState | undefined> {
  return await withCdpTarget(target, async (socket, idCounter) => {
    await cdpSend(socket, idCounter, 'Page.enable').catch(() => undefined)
    await cdpSend(socket, idCounter, 'Runtime.enable').catch(() => undefined)
    const result = await cdpSend<RuntimeEvaluateResult<ChatGptPromptState>>(socket, idCounter, 'Runtime.evaluate', {
      expression: chatGptTargetStateExpression(),
      awaitPromise: false,
      returnByValue: true,
    })
    const initialState = readRuntimeEvaluateValue(result)
    if (!initialState?.visiblePrompt || initialState.visibleSubmit || initialState.inputTextLength > 0) {
      return initialState
    }

    const smokeDraft = 'AgentOS browser smoke check - not submitted.'
    try {
      readRuntimeEvaluateValue(await cdpSend<RuntimeEvaluateResult<number>>(socket, idCounter, 'Runtime.evaluate', {
        expression: chatGptSetPromptExpression(smokeDraft),
        awaitPromise: false,
        returnByValue: true,
      }))
      await sleep(250)
      const probedState = readRuntimeEvaluateValue(await cdpSend<RuntimeEvaluateResult<ChatGptPromptState>>(socket, idCounter, 'Runtime.evaluate', {
        expression: chatGptTargetStateExpression(),
        awaitPromise: false,
        returnByValue: true,
      }))

      let clearedState: ChatGptPromptState | undefined
      try {
        readRuntimeEvaluateValue(await cdpSend<RuntimeEvaluateResult<boolean>>(socket, idCounter, 'Runtime.evaluate', {
          expression: chatGptFocusPromptExpression(),
          awaitPromise: false,
          returnByValue: true,
        }))
        await sleep(100)
        clearedState = readRuntimeEvaluateValue(await cdpSend<RuntimeEvaluateResult<ChatGptPromptState>>(socket, idCounter, 'Runtime.evaluate', {
          expression: chatGptTargetStateExpression(),
          awaitPromise: false,
          returnByValue: true,
        }))
      } catch {
        clearedState = undefined
      }

      if (probedState?.visibleSubmit) {
        const baseState = clearedState ?? initialState
        return {
          ...baseState,
          hasSubmit: probedState.hasSubmit,
          visibleSubmit: probedState.visibleSubmit,
          submitDisabled: probedState.submitDisabled,
          submitSelector: probedState.submitSelector,
          diagnostics: [
            baseState.diagnostics,
            `submitProbe=${probedState.submitSelector || 'found-after-draft'}`,
            `probeInputCleared=${(clearedState?.inputTextLength ?? -1) === 0 ? 'true' : 'unknown'}`,
          ].filter(Boolean).join('; '),
        }
      }

      return {
        ...initialState,
        diagnostics: [
          initialState.diagnostics,
          'submitProbe=missing-after-draft',
          probedState?.diagnostics,
        ].filter(Boolean).join('; '),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ...initialState,
        diagnostics: `${initialState.diagnostics}; submitProbeError=${message}`,
      }
    }
  })
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
    const submit = chatGptFindSendButton();
    const input = found?.element;
    const button = submit?.element;
    const text = input ? chatGptInputText(input) : '';
    return {
      url: location.href,
      title: document.title,
      hasPrompt: !!input,
      visiblePrompt: !!input,
      inputTextLength: text.trim().length,
      promptSelector: found?.selector,
      hasSubmit: !!button,
      visibleSubmit: button instanceof HTMLElement ? !!(button.offsetWidth || button.offsetHeight || button.getClientRects().length) : false,
      submitDisabled: button instanceof HTMLElement ? button.disabled === true || button.getAttribute('aria-disabled') === 'true' : true,
      submitSelector: submit?.selector,
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
          workerNarration: '扫描 Brave CDP 目标，没有找到 ChatGPT 页面，准备创建新 target。',
          domSummary: summarizeCdpTargets(allTargets),
          failureEvidence: lastError,
          snapshot: {
            targetUrl,
            chatgpt: {
              url: targetUrl,
              loginState: 'unknown',
            },
          },
        })
        const opened = await openBraveCdpTarget(port, targetUrl)
        if (opened.webSocketDebuggerUrl) {
          onStatus?.({
            phase: 'browser_prepare',
            message: '已创建 ChatGPT 页面目标',
            detail: opened.url || targetUrl,
            workerNarration: 'Brave CDP 已返回可连接的 ChatGPT target。',
            snapshot: {
              targetUrl,
              target: {
                id: opened.id,
                url: opened.url || targetUrl,
                title: opened.title,
              },
              chatgpt: {
                url: opened.url || targetUrl,
                title: opened.title,
                loginState: 'unknown',
              },
            },
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
  let lastSnapshot: Partial<AgentOSBrowserWorkerSnapshot> | undefined

  while (Date.now() < deadline) {
    try {
      const state = await cdpSend<RuntimeEvaluateResult<ChatGptPromptState>>(socket, idCounter, 'Runtime.evaluate', {
        expression: chatGptTargetStateExpression(),
        awaitPromise: false,
        returnByValue: true,
      })
      const promptState = readRuntimeEvaluateValue(state)
      lastSnapshot = snapshotFromChatGptPromptState(promptState)
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
        workerNarration: 'ChatGPT 页面已打开，但当前 DOM 还没有可写输入框。',
        domSummary: lastError,
        failureEvidence: lastError,
        snapshot: lastSnapshot,
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
        workerNarration: '已通过 Brave CDP 连接到 ChatGPT target，准备检查输入框。',
        snapshot: {
          targetUrl: args.targetUrl,
          target: {
            id: target.id,
            url: target.url || args.targetUrl,
            title: target.title,
          },
          chatgpt: {
            url: target.url || args.targetUrl,
            title: target.title,
          },
        },
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
                workerNarration: '当前 ChatGPT 页面有可写输入框，直接复用这个 tab。',
                domSummary: summarizeChatGptPromptState(initialState),
                snapshot: snapshotFromChatGptPromptState(initialState),
              })
            } else {
              args.onStatus?.({
                phase: 'browser_prompt',
                message: 'ChatGPT 页面未就绪，重新打开输入区',
                detail: initialState?.diagnostics || target.url || args.targetUrl,
                workerNarration: 'ChatGPT target 存在，但输入区不可用，准备导航回首页重新探测。',
                domSummary: summarizeChatGptPromptState(initialState),
                failureEvidence: initialState?.diagnostics,
                snapshot: snapshotFromChatGptPromptState(initialState),
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
            args.onStatus?.({
              phase: 'browser_prompt',
              message: promptState?.hasExpectedPrefix ? '已写入 ChatGPT 提示词' : '正在校验 ChatGPT 提示词写入',
              detail: `textLength=${promptState?.textLength ?? 0}; button=${promptState?.buttonVisible ? (promptState.buttonDisabled ? 'disabled' : 'ready') : 'missing'}`,
              workerNarration: promptState?.hasExpectedPrefix
                ? '提示词已经进入 ChatGPT 输入框，下一步检查发送按钮。'
                : '直接写入后校验未通过，准备必要时用剪贴板 fallback。',
              domSummary: promptState?.diagnostics,
              failureEvidence: promptState?.hasExpectedPrefix ? undefined : promptState?.diagnostics,
              snapshot: {
                chatgpt: {
                  promptInserted: !!promptState?.hasExpectedPrefix,
                  promptLength: promptState?.textLength ?? 0,
                  submitFound: promptState?.buttonVisible,
                  submitVisible: promptState?.buttonVisible,
                  submitDisabled: promptState?.buttonDisabled,
                  diagnostics: promptState?.diagnostics,
                },
              },
            })
            if (!promptState?.textLength || promptState.textLength < 10 || !promptState.hasExpectedPrefix || promptState.buttonDisabled) {
              args.onStatus?.({
                phase: 'browser_prompt',
                message: '直接写入不稳定，改用剪贴板粘贴',
                detail: `textLength=${promptState?.textLength ?? 0}; hasExpectedPrefix=${promptState?.hasExpectedPrefix ? 'true' : 'false'}`,
                workerNarration: 'CDP insertText 后页面状态不满足提交条件，切到剪贴板粘贴 fallback。',
                domSummary: promptState?.diagnostics,
                failureEvidence: promptState?.diagnostics,
              })
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
              args.onStatus?.({
                phase: 'browser_prompt',
                message: promptState?.hasExpectedPrefix ? '剪贴板粘贴已写入提示词' : '剪贴板粘贴后仍未校验通过',
                detail: `textLength=${promptState?.textLength ?? 0}; button=${promptState?.buttonVisible ? (promptState.buttonDisabled ? 'disabled' : 'ready') : 'missing'}`,
                workerNarration: promptState?.hasExpectedPrefix
                  ? '剪贴板 fallback 生效，准备提交。'
                  : '剪贴板 fallback 后仍然没有可靠写入，保留失败证据。',
                domSummary: promptState?.diagnostics,
                failureEvidence: promptState?.hasExpectedPrefix ? undefined : promptState?.diagnostics,
                snapshot: {
                  chatgpt: {
                    promptInserted: !!promptState?.hasExpectedPrefix,
                    promptLength: promptState?.textLength ?? 0,
                    submitFound: promptState?.buttonVisible,
                    submitVisible: promptState?.buttonVisible,
                    submitDisabled: promptState?.buttonDisabled,
                    diagnostics: promptState?.diagnostics,
                  },
                },
              })
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
            args.onStatus?.({
              phase: 'browser_prompt',
              message: '已点击 ChatGPT 发送按钮',
              detail: '等待会话 URL 或页面正文确认提交。',
              workerNarration: '发送按钮已点击，开始确认 ChatGPT 是否接受了这条图片提示词。',
              snapshot: {
                chatgpt: {
                  submitFound: true,
                  submitVisible: true,
                  submitDisabled: false,
                },
              },
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
                args.onStatus?.({
                  phase: 'browser_waiting',
                  message: 'ChatGPT 已接受图片提示词',
                  detail: submittedState.url || latestUrl,
                  workerNarration: '页面状态确认提示词已经提交，接下来等待图片结果。',
                  snapshot: {
                    chatgpt: {
                      url: submittedState.url || latestUrl,
                      inputTextLength: submittedState.inputTextLength,
                    },
                  },
                })
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
  onStatus?: BrowserRunStatusEmitter
}): Promise<CapturedChatGptImage> {
  const deadline = Date.now() + args.timeoutMs
  let lastError = 'No ChatGPT image target found'
  let lastStatusAt = 0
  let lastEvidencePath: string | undefined
  let lastScreenshotPath: string | undefined
  let lastDomSummary: string | undefined
  let lastImageCandidateCount: number | undefined

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
          if (args.onStatus && Date.now() - lastStatusAt > 10_000) {
            lastStatusAt = Date.now()
            args.onStatus({
              phase: 'browser_waiting',
              message: '检查 ChatGPT 图片结果',
              detail: target.url || args.preferredUrl || 'https://chatgpt.com/',
              workerNarration: '正在查看 ChatGPT 页面里是否已经出现可捕获的大图。',
              snapshot: {
                target: {
                  id: target.id,
                  url: target.url,
                  title: target.title,
                },
                chatgpt: {
                  url: target.url,
                  title: target.title,
                  imageFound: false,
                  capturePath: args.outputPath,
                },
              },
            })
          }
          const captured = await withCdpTarget(target, async (socket, idCounter) => {
            await cdpSend(socket, idCounter, 'Page.enable')
            const evidence = readRuntimeEvaluateValue(await cdpSend<RuntimeEvaluateResult<ChatGptImagePageEvidence>>(socket, idCounter, 'Runtime.evaluate', {
              expression: imageEvidenceExpression(),
              awaitPromise: false,
              returnByValue: true,
            }).catch(() => undefined))
            lastDomSummary = summarizeImageEvidence(evidence)
            lastImageCandidateCount = evidence?.imageCandidateCount
            lastEvidencePath = await persistImageEvidence({
              outputPath: args.outputPath,
              target,
              evidence,
              error: lastError,
            }) ?? lastEvidencePath
            if (!lastScreenshotPath) {
              const screenshotPath = imageEvidencePathForOutput(args.outputPath, '.evidence.png')
              const screenshot = await cdpSend<{ data: string }>(socket, idCounter, 'Page.captureScreenshot', {
                format: 'png',
              }).catch(() => undefined)
              if (screenshot?.data) {
                await mkdir(dirname(screenshotPath), { recursive: true })
                await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
                lastScreenshotPath = screenshotPath
              }
            }
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
            args.onStatus?.({
              phase: 'browser_waiting',
              message: '已发现 ChatGPT 图片候选',
              detail: `${Math.round(rect.naturalWidth || rect.width)}x${Math.round(rect.naturalHeight || rect.height)}`,
              workerNarration: '页面里已经出现足够大的图片，准备下载原图或截图裁切。',
              domSummary: lastDomSummary,
              snapshot: {
                target: {
                  id: target.id,
                  url: target.url,
                  title: target.title,
                },
                chatgpt: {
                  url: target.url,
                  title: target.title,
                  imageFound: true,
                  imageWidth: Math.round(rect.naturalWidth || rect.width),
                  imageHeight: Math.round(rect.naturalHeight || rect.height),
                  capturePath: args.outputPath,
                  evidencePath: lastEvidencePath,
                  screenshotPath: lastScreenshotPath,
                  imageCandidateCount: lastImageCandidateCount,
                  diagnostics: lastDomSummary,
                },
              },
            })
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
                evidencePath: lastEvidencePath,
                screenshotPath: lastScreenshotPath,
                imageCandidateCount: lastImageCandidateCount,
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
              evidencePath: lastEvidencePath,
              screenshotPath: lastScreenshotPath,
              imageCandidateCount: lastImageCandidateCount,
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

    if (args.onStatus && Date.now() - lastStatusAt > 15_000) {
      lastStatusAt = Date.now()
      args.onStatus({
        phase: 'browser_waiting',
        message: '继续等待 ChatGPT 图片',
        detail: lastError,
        workerNarration: '还没有捕获到满足尺寸条件的图片，继续轮询当前 ChatGPT 页面。',
        failureEvidence: [lastError, lastDomSummary, lastEvidencePath ? `evidence=${lastEvidencePath}` : undefined].filter(Boolean).join('; '),
        domSummary: lastDomSummary,
        snapshot: {
          chatgpt: {
            imageFound: false,
            capturePath: args.outputPath,
            evidencePath: lastEvidencePath,
            screenshotPath: lastScreenshotPath,
            imageCandidateCount: lastImageCandidateCount,
            diagnostics: lastDomSummary || lastError,
          },
        },
      })
    }
    await sleep(3_000)
  }

  throw enrichImageCaptureError(
    new Error([lastError, lastEvidencePath ? `evidencePath=${lastEvidencePath}` : undefined].filter(Boolean).join('; ')),
    {
      evidencePath: lastEvidencePath,
      screenshotPath: lastScreenshotPath,
      domSummary: lastDomSummary,
      imageCandidateCount: lastImageCandidateCount,
    },
  )
}

async function inspectExistingChatGptTargetForSmoke(args: {
  port: number
  targetUrl: string
  listTargets: (port: number) => Promise<BraveCdpTarget[]>
  inspectTarget: (target: BraveCdpTarget) => Promise<ChatGptPromptState | undefined>
}): Promise<{
  success: boolean
  targetSummary: string
  target?: BraveCdpTarget
  state?: ChatGptPromptState
  diagnostics: string
  error?: string
}> {
  const allTargets = await args.listTargets(args.port)
  const targetSummary = summarizeCdpTargets(allTargets)
  const chatGptTargets = allTargets
    .filter((target) => target.type === 'page' && target.webSocketDebuggerUrl && isChatGptTargetUrl(target.url))

  if (chatGptTargets.length === 0) {
    const error = `No ChatGPT page target found; CDP has ${targetSummary}`
    return {
      success: false,
      targetSummary,
      diagnostics: error,
      error,
    }
  }

  let best: { target: BraveCdpTarget; state?: ChatGptPromptState; error?: string } | undefined
  const inspectionErrors: string[] = []

  for (const target of chatGptTargets.slice(0, 4)) {
    try {
      const state = await args.inspectTarget(target)
      const current = { target, state }
      if (state?.visiblePrompt && state.visibleSubmit) {
        return {
          success: true,
          targetSummary,
          target,
          state,
          diagnostics: summarizeChatGptPromptState(state) || state.diagnostics,
        }
      }
      if (!best || (state?.visiblePrompt && !best.state?.visiblePrompt)) {
        best = current
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      inspectionErrors.push(`${target.url || target.id}: ${message}`)
      if (!best) {
        best = { target, error: message }
      }
    }
  }

  if (best?.state) {
    const diagnostics = summarizeChatGptPromptState(best.state) || best.state.diagnostics
    const error = !best.state.visiblePrompt
      ? `ChatGPT prompt input not found; ${diagnostics}`
      : `ChatGPT submit button not found; ${diagnostics}`
    return {
      success: false,
      targetSummary,
      target: best.target,
      state: best.state,
      diagnostics,
      error,
    }
  }

  const diagnostics = inspectionErrors.length > 0
    ? inspectionErrors.join('; ')
    : `ChatGPT target found but DOM inspection returned no state; ${targetSummary}`
  return {
    success: false,
    targetSummary,
    target: best?.target,
    diagnostics,
    error: `ChatGPT target DOM inspection failed; ${diagnostics}`,
  }
}

export async function runAgentOSBraveChatGptSmoke(args: {
  port?: number
  targetUrl?: string
  runId?: string
  dependencies?: AgentOSBrowserSmokeDependencies
} = {}): Promise<AgentOSBrowserSmokeResult> {
  const startedAt = new Date().toISOString()
  const capability = resolveAgentOSBrowserUseCapability()
  const port = args.port ?? capability.remoteDebuggingPort
  const targetUrl = args.targetUrl || 'https://chatgpt.com/'
  const runId = args.runId || `agentos-browser-smoke-${Date.now()}`
  const worker = args.dependencies?.worker ?? getAgentOSBrowserWorker()
  const listTargets = args.dependencies?.listTargets ?? listBraveCdpTargets
  const inspectTarget = args.dependencies?.inspectTarget ?? inspectChatGptTargetPromptState
  const prompt = 'AgentOS Browser Worker smoke check. Do not submit.'

  await worker.startRun({
    runId,
    task: 'chatgpt_prompt',
    targetUrl,
    prompt,
  })

  try {
    await worker.record({
      runId,
      phase: 'browser_smoke',
      status: 'info',
      message: 'Browser smoke 正在检查 Brave CDP 和 ChatGPT DOM',
      detail: `port=${port}; target=${targetUrl}; mode=reuse-existing-target`,
      snapshot: {
        targetUrl,
        chatgpt: {
          url: targetUrl,
          loginState: 'unknown',
        },
      },
    })

    const inspected = await inspectExistingChatGptTargetForSmoke({
      port,
      targetUrl,
      listTargets,
      inspectTarget,
    })
    const snapshot = smokeSnapshot({
      targetUrl,
      target: inspected.target,
      state: inspected.state,
      diagnostics: inspected.diagnostics,
    })

    await worker.record({
      runId,
      phase: 'browser_smoke',
      status: inspected.success ? 'ok' : 'error',
      message: inspected.success
        ? 'Browser smoke 已确认 ChatGPT 输入框和提交按钮'
        : 'Browser smoke 未通过 ChatGPT DOM 检查',
      detail: inspected.diagnostics,
      evidence: inspected.error,
      snapshot,
    })
    await worker.finishRun({
      runId,
      status: inspected.success ? 'ok' : 'error',
      message: inspected.success ? 'Browser smoke 验收通过' : 'Browser smoke 验收失败',
      error: inspected.error,
    })

    return {
      success: inspected.success,
      runId,
      adapter: 'brave_cdp_smoke',
      targetUrl,
      port,
      startedAt,
      endedAt: new Date().toISOString(),
      targetSummary: inspected.targetSummary,
      target: snapshot.target,
      chatgpt: snapshot.chatgpt,
      diagnostics: inspected.diagnostics,
      workerStatusUrl: worker.getStatusUrl(),
      error: inspected.error,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const snapshot = smokeSnapshot({
      targetUrl,
      diagnostics: message,
    })
    await worker.record({
      runId,
      phase: 'browser_smoke',
      status: 'error',
      message: 'Browser smoke CDP 检查失败',
      detail: message,
      evidence: message,
      snapshot,
    })
    await worker.finishRun({
      runId,
      status: 'error',
      message: 'Browser smoke 验收失败',
      error: message,
    })
    return {
      success: false,
      runId,
      adapter: 'brave_cdp_smoke',
      targetUrl,
      port,
      startedAt,
      endedAt: new Date().toISOString(),
      targetSummary: 'unavailable',
      chatgpt: snapshot.chatgpt,
      diagnostics: message,
      workerStatusUrl: worker.getStatusUrl(),
      error: message,
    }
  }
}

export async function runAgentOSBraveChatGptImageE2E(args: {
  prompt: string
  outputPath: string
  port?: number
  targetUrl?: string
  runId?: string
  submitTimeoutMs?: number
  waitForImageMs?: number
  onStatus?: (status: AgentOSBrowserImageE2EStatus) => void
  dependencies?: AgentOSBrowserSmokeDependencies
}): Promise<AgentOSBrowserImageE2EResult> {
  const startedAt = new Date().toISOString()
  const capability = args.dependencies?.capability ?? resolveAgentOSBrowserUseCapability()
  const port = args.port ?? capability.remoteDebuggingPort
  const targetUrl = args.targetUrl || 'https://chatgpt.com/'
  const runId = args.runId || `agentos-browser-e2e-${Date.now()}`
  const worker = args.dependencies?.worker ?? getAgentOSBrowserWorker()
  const ensureCdp = args.dependencies?.ensureBraveCdp ?? ensureBraveCdp
  const submitPrompt = args.dependencies?.submitPrompt ?? submitChatGptPromptWithCdp
  const waitForImage = args.dependencies?.waitForImage ?? (async () => undefined)
  const captureImage = args.dependencies?.captureImage ?? captureLatestChatGptImageFromBrave
  const submitTimeoutMs = args.submitTimeoutMs ?? 120_000
  const waitForImageMs = args.waitForImageMs ?? 300_000
  let conversationUrl: string | undefined

  const recordStatus = (status: AgentOSBrowserImageE2EStatus) => recordImageE2EStatus({
    worker,
    runId,
    onStatus: args.onStatus,
    status,
  })
  const forwardBrowserStatus: BrowserRunStatusEmitter = (status) => {
    void recordStatus(mapBrowserRunStatusToImageE2E(status))
  }

  await worker.startRun({
    runId,
    task: 'chatgpt_image',
    targetUrl,
    prompt: args.prompt,
    capturePath: args.outputPath,
  })

  if (!capability.enabled) {
    const diagnostics = capability.reason || 'AgentOS Browser Use is unavailable'
    await recordStatus({
      phase: 'browser_failure',
      status: 'error',
      message: 'Brave/ChatGPT E2E 生图不可用',
      detail: diagnostics,
      workerNarration: 'Browser worker 已启动，但 Brave 能力检查未通过。',
      failureEvidence: diagnostics,
      snapshot: {
        targetUrl,
        chatgpt: {
          url: targetUrl,
          loginState: 'not_ready',
          capturePath: args.outputPath,
          diagnostics,
        },
      },
    })
    await worker.finishRun({
      runId,
      status: 'error',
      message: 'Browser worker E2E 生图失败',
      error: diagnostics,
    })
    return {
      success: false,
      runId,
      adapter: 'brave_cdp_image_e2e',
      prompt: args.prompt,
      targetUrl,
      port,
      outputPath: args.outputPath,
      startedAt,
      endedAt: new Date().toISOString(),
      diagnostics,
      workerStatusUrl: worker.getStatusUrl(),
      error: diagnostics,
    }
  }

  try {
    await recordStatus({
      phase: 'browser_connect',
      message: '连接 Brave CDP',
      detail: `port=${port}; target=${targetUrl}`,
      workerNarration: '开始连接或复用 Brave CDP，不盲目新开页面。',
      snapshot: {
        targetUrl,
        chatgpt: {
          url: targetUrl,
          loginState: 'unknown',
          capturePath: args.outputPath,
        },
      },
    })
    const braveState = await ensureCdp({
      executablePath: capability.executablePath,
      profileDir: capability.profileDir,
      remoteDebuggingPort: port,
      targetUrl,
    })
    await recordStatus({
      phase: 'browser_input',
      message: braveState === 'reused' ? '复用 Brave ChatGPT 输入区' : '打开 Brave ChatGPT 输入区',
      detail: `prompt_chars=${args.prompt.length}`,
      workerNarration: 'Brave CDP 已就绪，下一步定位 ChatGPT 输入框。',
      snapshot: {
        targetUrl,
        chatgpt: {
          url: targetUrl,
          promptLength: args.prompt.length,
          capturePath: args.outputPath,
        },
      },
    })
    await recordStatus({
      phase: 'browser_write',
      message: '写入 ChatGPT 图片提示词',
      detail: `prompt_chars=${args.prompt.length}`,
      workerNarration: '准备把显式 E2E 图片提示词写进 ChatGPT。',
      snapshot: {
        chatgpt: {
          promptLength: args.prompt.length,
          capturePath: args.outputPath,
        },
      },
    })
    conversationUrl = await submitPrompt({
      port,
      prompt: args.prompt,
      targetUrl,
      timeoutMs: submitTimeoutMs,
      onStatus: forwardBrowserStatus,
    })
    await recordStatus({
      phase: 'browser_submit',
      message: 'ChatGPT 图片提示词已提交',
      detail: conversationUrl || targetUrl,
      workerNarration: '提交动作已完成，开始等待 ChatGPT 生成图片。',
      snapshot: {
        chatgpt: {
          url: conversationUrl || targetUrl,
          submitFound: true,
          submitVisible: true,
          submitDisabled: false,
          capturePath: args.outputPath,
        },
      },
    })
    await recordStatus({
      phase: 'browser_wait',
      message: '等待 ChatGPT 图片结果',
      detail: `最多等待 ${Math.round(waitForImageMs / 1000)} 秒`,
      workerNarration: '进入 E2E 等待阶段，后续会记录 DOM 摘要和候选图证据。',
      snapshot: {
        chatgpt: {
          url: conversationUrl || targetUrl,
          imageFound: false,
          capturePath: args.outputPath,
        },
      },
    })
    await waitForImage({
      port,
      outputPath: args.outputPath,
      timeoutMs: waitForImageMs,
      preferredUrl: conversationUrl,
      onStatus: forwardBrowserStatus,
    })
    await recordStatus({
      phase: 'browser_capture',
      message: '捕获 ChatGPT 图片',
      detail: args.outputPath,
      workerNarration: 'ChatGPT 等待阶段结束，开始保存页面图片。',
      snapshot: {
        chatgpt: {
          url: conversationUrl || targetUrl,
          capturePath: args.outputPath,
        },
      },
    })
    const image = await captureImage({
      port,
      outputPath: args.outputPath,
      timeoutMs: waitForImageMs,
      preferredUrl: conversationUrl,
      onStatus: forwardBrowserStatus,
    })
    await recordStatus({
      phase: 'browser_success',
      status: 'ok',
      message: 'Brave/ChatGPT E2E 生图验收通过',
      detail: args.outputPath,
      workerNarration: '真实提交、等待、捕获链路已经完成。',
      snapshot: {
        chatgpt: {
          url: conversationUrl || targetUrl,
          imageFound: true,
          imageWidth: image.width,
          imageHeight: image.height,
          capturePath: args.outputPath,
          evidencePath: image.evidencePath,
          screenshotPath: image.screenshotPath,
          imageCandidateCount: image.imageCandidateCount,
        },
      },
    })
    const record: AgentOSBrowserImageE2EResult = {
      success: true,
      runId,
      adapter: 'brave_cdp_image_e2e',
      prompt: args.prompt,
      targetUrl,
      port,
      outputPath: args.outputPath,
      conversationUrl,
      imagePath: args.outputPath,
      imageWidth: image.width,
      imageHeight: image.height,
      captureMethod: image.method,
      startedAt,
      endedAt: new Date().toISOString(),
      diagnostics: `image=${image.width}x${image.height}; method=${image.method}`,
      workerStatusUrl: worker.getStatusUrl(),
      evidencePath: image.evidencePath,
      screenshotPath: image.screenshotPath,
      imageCandidateCount: image.imageCandidateCount,
    }
    record.logPath = await appendBrowserE2ERunLog(record)
    await worker.finishRun({
      runId,
      status: 'ok',
      message: 'Browser worker E2E 生图完成',
    })
    return record
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const promptSnapshot = snapshotFromChatGptPromptFailure(error, targetUrl)
    const imageSnapshot = imageCaptureErrorSnapshot(error, targetUrl, args.outputPath)
    await recordStatus({
      phase: 'browser_failure',
      status: 'error',
      message: 'Brave/ChatGPT E2E 生图失败',
      detail: message,
      workerNarration: '真实提交或等待捕获失败，保留 URL、DOM 摘要、候选图证据和截图路径。',
      failureEvidence: [
        message,
        imageSnapshot.chatgpt?.diagnostics,
        imageSnapshot.chatgpt?.evidencePath ? `evidence=${imageSnapshot.chatgpt.evidencePath}` : undefined,
        imageSnapshot.chatgpt?.screenshotPath ? `screenshot=${imageSnapshot.chatgpt.screenshotPath}` : undefined,
      ].filter(Boolean).join('; '),
      domSummary: imageSnapshot.chatgpt?.diagnostics,
      snapshot: {
        targetUrl,
        chatgpt: {
          ...promptSnapshot.chatgpt,
          ...imageSnapshot.chatgpt,
          url: conversationUrl || promptSnapshot.chatgpt?.url || imageSnapshot.chatgpt?.url || targetUrl,
        },
      },
    })
    const record: AgentOSBrowserImageE2EResult = {
      success: false,
      runId,
      adapter: 'brave_cdp_image_e2e',
      prompt: args.prompt,
      targetUrl,
      port,
      outputPath: args.outputPath,
      conversationUrl,
      startedAt,
      endedAt: new Date().toISOString(),
      diagnostics: imageSnapshot.chatgpt?.diagnostics || message,
      workerStatusUrl: worker.getStatusUrl(),
      evidencePath: imageSnapshot.chatgpt?.evidencePath,
      screenshotPath: imageSnapshot.chatgpt?.screenshotPath,
      imageCandidateCount: imageSnapshot.chatgpt?.imageCandidateCount,
      error: message,
    }
    record.logPath = await appendBrowserE2ERunLog(record)
    await worker.finishRun({
      runId,
      status: 'error',
      message: 'Browser worker E2E 生图失败',
      error: message,
    })
    return record
  }
}

export const agentOSBrowserUseRunnerTestables = {
  chatGptPromptStateExpression,
  chatGptSetPromptExpression,
  chatGptSubmitExpression,
  chatGptTargetStateExpression,
  inspectExistingChatGptTargetForSmoke,
  isChatGptTargetUrl,
  snapshotFromChatGptPromptFailure,
  snapshotFromChatGptPromptState,
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

async function appendBrowserE2ERunLog(record: AgentOSBrowserImageE2EResult): Promise<string | undefined> {
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
  finishOnSubmit?: boolean
  workerTask?: 'chatgpt_prompt' | 'chatgpt_image'
  capturePath?: string
}): Promise<AgentOSBrowserUseRunResult> {
  const runId = `agentos-browser-${Date.now()}`
  const startedAt = new Date().toISOString()
  const targetUrl = args.targetUrl || 'https://chatgpt.com/'
  const capability = resolveAgentOSBrowserUseCapability()
  const worker = getAgentOSBrowserWorker()
  await worker.startRun({
    runId,
    task: args.workerTask ?? 'chatgpt_prompt',
    targetUrl,
    prompt: args.prompt,
    capturePath: args.capturePath,
  })
  const emitStatus = (status: BrowserRunStatus) => emitBrowserRunStatus(runId, args.onStatus, status)

  if (!capability.enabled) {
    emitStatus({
      phase: 'browser_error',
      message: 'AgentOS Browser Use 不可用',
      detail: capability.reason || 'AgentOS Browser Use is unavailable',
      workerNarration: 'Browser worker 已启动，但 Brave 能力检查未通过，保留 mock fallback。',
      failureEvidence: capability.reason || 'AgentOS Browser Use is unavailable',
      snapshot: {
        targetUrl,
        chatgpt: {
          url: targetUrl,
          loginState: 'not_ready',
        },
      },
    })
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
    await worker.finishRun({
      runId,
      status: 'error',
      message: 'Browser worker 能力检查失败',
      error: failed.error,
    })
    return failed
  }

  try {
    emitStatus({
      phase: 'browser_prepare',
      message: '检查 Brave 和 ChatGPT 页面',
      detail: `CDP 端口 ${capability.remoteDebuggingPort}`,
      workerNarration: '先检查 Brave CDP 端口和 ChatGPT target，避免盲目新开页面。',
      snapshot: {
        targetUrl,
        chatgpt: {
          url: targetUrl,
          loginState: 'unknown',
        },
      },
    })
    const braveState = await ensureBraveCdp({
      executablePath: capability.executablePath,
      profileDir: capability.profileDir,
      remoteDebuggingPort: capability.remoteDebuggingPort,
      targetUrl,
    })
    emitStatus({
      phase: 'browser_prepare',
      message: braveState === 'reused' ? '复用已打开的 Brave' : '已打开 Brave',
      detail: '下一步把准备好的图片提示词写入 ChatGPT。',
      workerNarration: braveState === 'reused'
        ? 'Brave CDP 已可用，复用现有浏览器实例。'
        : 'Brave 已用独立 AgentOS profile 启动，CDP 端口可用。',
      snapshot: {
        targetUrl,
      },
    })
    await waitForBraveAppleEvents(12_000).catch(() => undefined)
    emitStatus({
      phase: 'browser_prompt',
      message: '正在写入 ChatGPT 提示词',
      detail: `提示词 ${args.prompt.length} 字符`,
      workerNarration: '准备把已生成的图片提示词写入 ChatGPT 输入框。',
      snapshot: {
        chatgpt: {
          promptLength: args.prompt.length,
        },
      },
    })
    const conversationUrl = await submitChatGptPromptWithCdp({
      port: capability.remoteDebuggingPort,
      prompt: args.prompt,
      targetUrl,
      timeoutMs: args.timeoutMs ?? 120_000,
      onStatus: emitStatus,
    })
    emitStatus({
      phase: 'browser_waiting',
      message: '图片提示词已提交',
      detail: conversationUrl || targetUrl,
      workerNarration: 'ChatGPT 已收到提示词，等待模型生成图片或返回可捕获结果。',
      snapshot: {
        chatgpt: {
          url: conversationUrl || targetUrl,
        },
      },
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
    if (args.finishOnSubmit !== false) {
      await worker.finishRun({
        runId,
        status: 'ok',
        message: 'Browser worker 已提交提示词',
      })
    }
    return record
  } catch (error) {
    const failureSnapshot = snapshotFromChatGptPromptFailure(error, targetUrl)
    emitStatus({
      phase: 'browser_error',
      message: 'Brave/ChatGPT 提示词提交失败',
      detail: error instanceof Error ? error.message : String(error),
      workerNarration: '提示词提交链路失败，保留当前页面和 DOM 证据供排查。',
      failureEvidence: error instanceof Error ? error.message : String(error),
      snapshot: failureSnapshot,
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
    await worker.finishRun({
      runId,
      status: 'error',
      message: 'Browser worker 提示词提交失败',
      error: record.error,
    })
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
    finishOnSubmit: false,
    workerTask: 'chatgpt_image',
    capturePath: args.outputPath,
  })
  const worker = getAgentOSBrowserWorker()
  const emitStatus = (status: BrowserRunStatus) => emitBrowserRunStatus(promptResult.runId, args.onStatus, status)

  if (!promptResult.success) {
    return promptResult
  }

  if (!capability.enabled) {
    await worker.finishRun({
      runId: promptResult.runId,
      status: 'error',
      message: 'Browser worker 能力检查失败',
      error: capability.reason || 'AgentOS Browser Use is unavailable',
    })
    return {
      ...promptResult,
      success: false,
      error: capability.reason || 'AgentOS Browser Use is unavailable',
    }
  }

  try {
    await mkdir(join(args.outputPath, '..'), { recursive: true })
    emitStatus({
      phase: 'browser_waiting',
      message: '等待 ChatGPT 图片出现在页面里',
      detail: `最多等待 ${Math.round((args.waitForImageMs ?? 300_000) / 1000)} 秒`,
      workerNarration: '提示词已提交，开始轮询 ChatGPT 页面中的生成图片。',
      snapshot: {
        chatgpt: {
          capturePath: args.outputPath,
          imageFound: false,
        },
      },
    })
    const image = await captureLatestChatGptImageFromBrave({
      port: capability.remoteDebuggingPort,
      outputPath: args.outputPath,
      timeoutMs: args.waitForImageMs ?? 300_000,
      preferredUrl: promptResult.conversationUrl,
      onStatus: emitStatus,
    })
    emitStatus({
      phase: 'browser_capture',
      message: '已捕获 ChatGPT 图片',
      detail: args.outputPath,
      workerNarration: '图片文件已经保存到 Skill Moments media 目录。',
      snapshot: {
        chatgpt: {
          imageFound: true,
          imageWidth: image.width,
          imageHeight: image.height,
          capturePath: args.outputPath,
        },
      },
    })
    const record: AgentOSBrowserImageRunResult = {
      ...promptResult,
      imagePath: args.outputPath,
      imageWidth: image.width,
      imageHeight: image.height,
      captureMethod: image.method,
    }
    record.logPath = await appendBrowserRunLog(record)
    await worker.finishRun({
      runId: promptResult.runId,
      status: 'ok',
      message: 'Browser worker 已完成图片捕获',
    })
    return record
  } catch (error) {
    emitStatus({
      phase: 'browser_error',
      message: '图片生成或捕获失败',
      detail: error instanceof Error ? error.message : String(error),
      workerNarration: 'ChatGPT 图片等待或捕获失败，保留最后一次页面证据。',
      failureEvidence: error instanceof Error ? error.message : String(error),
      snapshot: {
        chatgpt: {
          imageFound: false,
          capturePath: args.outputPath,
        },
      },
    })
    const record: AgentOSBrowserImageRunResult = {
      ...promptResult,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
    record.logPath = await appendBrowserRunLog(record)
    await worker.finishRun({
      runId: promptResult.runId,
      status: 'error',
      message: 'Browser worker 图片捕获失败',
      error: record.error,
    })
    return record
  }
}
