import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type AgentOSBrowserWorkerEventStatus = 'info' | 'ok' | 'warning' | 'error'

export type AgentOSBrowserWorkerSnapshot = {
  runId?: string
  task?: 'chatgpt_prompt' | 'chatgpt_image'
  targetUrl?: string
  target?: {
    id?: string
    url?: string
    title?: string
  }
  chatgpt?: {
    url?: string
    title?: string
    loginState?: 'unknown' | 'ready' | 'not_ready'
    inputFound?: boolean
    inputVisible?: boolean
    inputTextLength?: number
    promptSelector?: string
    submitFound?: boolean
    submitVisible?: boolean
    submitDisabled?: boolean
    submitSelector?: string
    promptInserted?: boolean
    promptLength?: number
    imageFound?: boolean
    imageWidth?: number
    imageHeight?: number
    imageCandidateCount?: number
    capturePath?: string
    evidencePath?: string
    screenshotPath?: string
    diagnostics?: string
  }
  updatedAt: string
}

export type AgentOSBrowserWorkerEvent = {
  id: string
  runId?: string
  phase: string
  status: AgentOSBrowserWorkerEventStatus
  message: string
  detail?: string
  evidence?: string
  snapshot?: AgentOSBrowserWorkerSnapshot
  createdAt: string
}

type AgentOSBrowserWorkerServiceOptions = {
  storageDir?: string
  enableHttp?: boolean
  port?: number
}

type AgentOSBrowserWorkerControlResult = {
  ok: boolean
  action: string
  message: string
}

const RECENT_EVENT_LIMIT = 80

function trimText(value: string | undefined, maxLength = 1200): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  if (!trimmed) return undefined
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed
}

function summarizeSelector(
  selector: string | undefined,
  found: boolean | undefined,
): string {
  if (selector) return selector
  if (found === false) return 'missing'
  return 'unknown'
}

function buildFailureEvidence(args: {
  evidence?: string
  detail?: string
  snapshot?: AgentOSBrowserWorkerSnapshot
}): string | undefined {
  const chatgpt = args.snapshot?.chatgpt
  const targetUrl = args.snapshot?.targetUrl || args.snapshot?.target?.url || chatgpt?.url || 'unknown'
  const domSummary = chatgpt?.diagnostics || args.detail || args.evidence || 'no diagnostics'
  const fields = [
    args.evidence,
    `targetUrl=${targetUrl}`,
    `inputSelector=${summarizeSelector(chatgpt?.promptSelector, chatgpt?.inputFound)}`,
    `submitSelector=${summarizeSelector(chatgpt?.submitSelector, chatgpt?.submitFound)}`,
    `dom=${domSummary}`,
  ]
  return trimText(fields.filter(Boolean).join('; '))
}

function parsePort(value: string | undefined): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return 0
  }
  return port
}

function workerStorageDir(): string {
  return join(homedir(), '.craft-agent', 'agentos', 'browser-worker')
}

function mergeSnapshot(
  current: AgentOSBrowserWorkerSnapshot | undefined,
  patch: Partial<AgentOSBrowserWorkerSnapshot> | undefined,
  updatedAt: string,
): AgentOSBrowserWorkerSnapshot | undefined {
  if (!current && !patch) {
    return undefined
  }

  return {
    ...(current ?? { updatedAt }),
    ...(patch ?? {}),
    target: {
      ...(current?.target ?? {}),
      ...(patch?.target ?? {}),
    },
    chatgpt: {
      ...(current?.chatgpt ?? {}),
      ...(patch?.chatgpt ?? {}),
    },
    updatedAt,
  }
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': 'http://127.0.0.1',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  response.end(`${JSON.stringify(value, null, 2)}\n`)
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  if (!raw) return {}
  const parsed = JSON.parse(raw)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
}

export class AgentOSBrowserWorkerService {
  private readonly storageDir: string
  private readonly enableHttp: boolean
  private readonly requestedPort: number
  private readonly startedAt = new Date().toISOString()
  private readonly recentEvents: AgentOSBrowserWorkerEvent[] = []
  private server?: Server
  private serverPort?: number
  private startingServer?: Promise<void>
  private currentSnapshot?: AgentOSBrowserWorkerSnapshot
  private activeRunId?: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(options: AgentOSBrowserWorkerServiceOptions = {}) {
    this.storageDir = options.storageDir ?? workerStorageDir()
    this.enableHttp = options.enableHttp ?? true
    this.requestedPort = options.port ?? parsePort(process.env.CRAFT_AGENTOS_BROWSER_WORKER_PORT)
  }

  getStatusUrl(): string | undefined {
    return this.serverPort ? `http://127.0.0.1:${this.serverPort}/status` : undefined
  }

  health() {
    return {
      ok: true,
      service: 'agentos-browser-worker',
      mode: 'local-observable',
      activeRunId: this.activeRunId,
      startedAt: this.startedAt,
      storageDir: this.storageDir,
      port: this.serverPort,
      endpoints: this.serverPort
        ? {
          health: `http://127.0.0.1:${this.serverPort}/health`,
          bridge: `http://127.0.0.1:${this.serverPort}/bridge`,
          rpc: `http://127.0.0.1:${this.serverPort}/rpc`,
          control: `http://127.0.0.1:${this.serverPort}/control`,
          status: `http://127.0.0.1:${this.serverPort}/status`,
          snapshot: `http://127.0.0.1:${this.serverPort}/snapshot`,
          diagnostics: `http://127.0.0.1:${this.serverPort}/diagnostics/recent`,
        }
        : undefined,
    }
  }

  status() {
    return {
      health: this.health(),
      current: {
        runId: this.activeRunId,
        snapshot: this.currentSnapshot,
      },
      recentEvents: this.recentEvents.slice(0, 20),
    }
  }

  async startRun(args: {
    runId: string
    task: 'chatgpt_prompt' | 'chatgpt_image'
    targetUrl: string
    prompt: string
    capturePath?: string
  }): Promise<void> {
    await this.ensureHttpServer()
    if (this.activeRunId && this.activeRunId !== args.runId) {
      const message = `Browser worker already has an active run: ${this.activeRunId}`
      await this.record({
        phase: 'worker_reject',
        status: 'warning',
        message: 'Browser worker rejected concurrent run',
        detail: `activeRunId=${this.activeRunId}; rejectedRunId=${args.runId}; rejectedTarget=${args.targetUrl}`,
        evidence: message,
      })
      throw new Error(`${message}; rejectedRunId=${args.runId}`)
    }

    const now = new Date().toISOString()
    this.activeRunId = args.runId
    this.currentSnapshot = {
      runId: args.runId,
      task: args.task,
      targetUrl: args.targetUrl,
      chatgpt: {
        url: args.targetUrl,
        loginState: 'unknown',
        promptLength: args.prompt.length,
        capturePath: args.capturePath,
      },
      updatedAt: now,
    }
    await this.record({
      runId: args.runId,
      phase: 'worker_start',
      status: 'info',
      message: args.task === 'chatgpt_image' ? 'Browser worker 准备生图' : 'Browser worker 准备提交提示词',
      detail: `target=${args.targetUrl}; prompt_chars=${args.prompt.length}`,
      snapshot: this.currentSnapshot,
    })
  }

  async record(args: {
    runId?: string
    phase: string
    status: AgentOSBrowserWorkerEventStatus
    message: string
    detail?: string
    evidence?: string
    snapshot?: Partial<AgentOSBrowserWorkerSnapshot>
  }): Promise<void> {
    const createdAt = new Date().toISOString()
    const snapshot = mergeSnapshot(this.currentSnapshot, args.snapshot, createdAt)
    this.currentSnapshot = snapshot
    if (args.runId) {
      this.activeRunId = args.runId
    }

    const event: AgentOSBrowserWorkerEvent = {
      id: randomUUID(),
      runId: args.runId,
      phase: args.phase,
      status: args.status,
      message: trimText(args.message, 600) || args.phase,
      detail: trimText(args.detail),
      evidence: args.status === 'error'
        ? buildFailureEvidence({
          evidence: args.evidence,
          detail: args.detail,
          snapshot,
        })
        : trimText(args.evidence),
      snapshot,
      createdAt,
    }
    this.recentEvents.unshift(event)
    this.recentEvents.splice(RECENT_EVENT_LIMIT)
    await this.persist(event)
  }

  async finishRun(args: {
    runId: string
    status: 'ok' | 'error'
    message: string
    error?: string
  }): Promise<void> {
    await this.record({
      runId: args.runId,
      phase: 'worker_finish',
      status: args.status,
      message: args.message,
      evidence: args.error,
      snapshot: {
        runId: args.runId,
      },
    })
    if (this.activeRunId === args.runId) {
      this.activeRunId = undefined
    }
    await this.persist()
  }

  async control(action: string): Promise<AgentOSBrowserWorkerControlResult> {
    if (action !== 'reset') {
      return {
        ok: false,
        action,
        message: 'Unsupported control action. Supported: reset.',
      }
    }

    this.activeRunId = undefined
    this.currentSnapshot = undefined
    this.recentEvents.length = 0
    await this.persist()
    return {
      ok: true,
      action,
      message: 'Browser worker observable state reset.',
    }
  }

  async close(): Promise<void> {
    if (!this.server) return
    const server = this.server
    this.server = undefined
    this.serverPort = undefined
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async ensureHttpServer(): Promise<void> {
    if (!this.enableHttp || this.serverPort) return
    if (this.startingServer) {
      await this.startingServer
      return
    }

    this.startingServer = new Promise<void>((resolve) => {
      const startOnPort = (port: number) => {
        const server = createServer((request, response) => {
          void this.handleHttp(request, response)
        })
        server.once('error', () => {
          if (port !== 0) {
            startOnPort(0)
            return
          }
          resolve()
        })
        server.listen(port, '127.0.0.1', () => {
          const address = server.address()
          this.server = server
          this.serverPort = typeof address === 'object' && address ? address.port : undefined
          resolve()
        })
      }
      startOnPort(this.requestedPort)
    }).finally(() => {
      this.startingServer = undefined
    })

    await this.startingServer
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {})
      return
    }

    const url = new URL(request.url || '/', 'http://127.0.0.1')
    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, this.health())
        return
      }
      if (request.method === 'GET' && url.pathname === '/status') {
        sendJson(response, 200, this.status())
        return
      }
      if (request.method === 'GET' && url.pathname === '/snapshot') {
        sendJson(response, 200, this.currentSnapshot ?? null)
        return
      }
      if (request.method === 'GET' && url.pathname === '/diagnostics/recent') {
        sendJson(response, 200, { events: this.recentEvents })
        return
      }
      if (request.method === 'GET' && url.pathname === '/bridge') {
        sendJson(response, 200, {
          ok: true,
          bridge: 'agentos-browser-worker',
          status: this.status(),
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/rpc') {
        sendJson(response, 200, {
          ok: true,
          methods: ['health', 'status', 'snapshot', 'diagnostics.recent', 'control.reset'],
        })
        return
      }
      if (request.method === 'POST' && url.pathname === '/rpc') {
        const body = await readJsonBody(request)
        const method = String(body.method || '')
        if (method === 'health') sendJson(response, 200, this.health())
        else if (method === 'status') sendJson(response, 200, this.status())
        else if (method === 'snapshot') sendJson(response, 200, this.currentSnapshot ?? null)
        else if (method === 'diagnostics.recent') sendJson(response, 200, { events: this.recentEvents })
        else if (method === 'control.reset') sendJson(response, 200, await this.control('reset'))
        else sendJson(response, 404, { ok: false, error: `Unknown rpc method: ${method}` })
        return
      }
      if (request.method === 'POST' && url.pathname === '/control') {
        const body = await readJsonBody(request)
        const action = String(body.action || '')
        const result = await this.control(action)
        sendJson(response, result.ok ? 200 : 400, result)
        return
      }
      sendJson(response, 404, { ok: false, error: 'Not found' })
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async persist(event?: AgentOSBrowserWorkerEvent): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(this.storageDir, { recursive: true })
      await writeFile(join(this.storageDir, 'latest-status.json'), `${JSON.stringify(this.status(), null, 2)}\n`, 'utf-8')
      if (event) {
        await appendFile(join(this.storageDir, 'diagnostic-log.jsonl'), `${JSON.stringify(event)}\n`, 'utf-8')
      }
    }).catch(() => undefined)
    await this.writeQueue
  }
}

let singleton: AgentOSBrowserWorkerService | undefined

export function getAgentOSBrowserWorker(): AgentOSBrowserWorkerService {
  if (!singleton) {
    singleton = new AgentOSBrowserWorkerService()
  }
  return singleton
}

export function createAgentOSBrowserWorkerService(options: AgentOSBrowserWorkerServiceOptions = {}): AgentOSBrowserWorkerService {
  return new AgentOSBrowserWorkerService(options)
}
