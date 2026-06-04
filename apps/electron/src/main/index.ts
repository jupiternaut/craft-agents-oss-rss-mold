// Load user's shell environment first (before other imports that may use env)
// This ensures tools like Homebrew, nvm, etc. are available to the agent
import { loadShellEnv } from './shell-env'
loadShellEnv()

import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron'
import { execFile, spawn } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { hostname, homedir, tmpdir } from 'os'
import * as Sentry from '@sentry/electron/main'

// Initialize Sentry error tracking as early as possible after app import.
// Only enabled in production (packaged) builds to avoid noise during development.
// DSN is baked in at build time via esbuild --define (same pattern as OAuth secrets).
//
// NOTE: Source map upload is intentionally disabled. Stack traces in Sentry will show
// bundled/minified code. To enable source map upload in the future:
//   1. Add SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT to CI secrets
//   2. Re-enable the @sentry/vite-plugin in vite.config.ts (handles renderer maps)
//   3. Add @sentry/esbuild-plugin to scripts/electron-build-main.ts (handles main process maps)
Sentry.init({
  dsn: process.env.SENTRY_ELECTRON_INGEST_URL,
  environment: app.isPackaged ? 'production' : 'development',
  release: app.getVersion(),
  // Enabled whenever the ingest URL is available — works in both production (baked via CI)
  // and development (injected via .env / 1Password). Filter by environment in Sentry dashboard.
  enabled: !!process.env.SENTRY_ELECTRON_INGEST_URL,

  // Scrub sensitive data before sending to Sentry.
  // Removes authorization headers, API keys/tokens, and credential-like values.
  beforeSend(event) {
    // Scrub request headers (authorization, cookies)
    if (event.request?.headers) {
      const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key']
      for (const header of sensitiveHeaders) {
        if (event.request.headers[header]) {
          event.request.headers[header] = '[REDACTED]'
        }
      }
    }

    // Scrub breadcrumb data that may contain sensitive values
    if (event.breadcrumbs) {
      for (const breadcrumb of event.breadcrumbs) {
        if (breadcrumb.data) {
          for (const key of Object.keys(breadcrumb.data)) {
            const lowerKey = key.toLowerCase()
            if (lowerKey.includes('token') || lowerKey.includes('key') ||
                lowerKey.includes('secret') || lowerKey.includes('password') ||
                lowerKey.includes('credential') || lowerKey.includes('auth')) {
              breadcrumb.data[key] = '[REDACTED]'
            }
          }
        }
      }
    }

    return event
  },
})

// Initialize i18n for main process (menus, dialogs, etc.)
import { setupI18n, i18n } from '@craft-agent/shared/i18n'
setupI18n()

// Set anonymous machine ID for Sentry user tracking (no PII — just a hash).
// Uses hostname + homedir to produce a stable per-machine identifier.
const machineId = createHash('sha256').update(hostname() + homedir()).digest('hex').slice(0, 16)
Sentry.setUser({ id: machineId })

import { basename, dirname, join, delimiter, relative, resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@craft-agent/server-core/sessions'
import { registerAllRpcHandlers } from './handlers/index'
import { registerCoreRpcHandlers, cleanupSessionFileWatchForClient } from '@craft-agent/server-core/handlers/rpc'
import {
  listSkillMomentsForWorkspace,
  recordSkillMomentFeedbackForWorkspace,
} from '@craft-agent/server-core/skill-moments'
import {
  getHomelanderFallenGodScenePack,
  pickHomelanderFallenGodCritiqueBody,
  selectHomelanderFallenGodCriticSlugs,
  selectHomelanderFallenGodMoment,
  type HomelanderFallenGodBeat,
  type HomelanderFallenGodMomentSelection,
} from '@craft-agent/shared/skill-moments'
import type { PlatformServices } from '../runtime/platform'
import { createElectronPlatform } from './platform'
import { resolveElectronAppRoot } from './app-root'
import type { HandlerDeps } from './handlers/handler-deps'
import { bootstrapServer, releaseServerLock } from '@craft-agent/server-core/bootstrap'
import { createMessagingBootstrap, type MessagingBootstrapHandle } from '@craft-agent/messaging-gateway'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { initModelRefreshService, getModelRefreshService, setFetcherPlatform } from '@craft-agent/server-core/model-fetchers'
import { setSearchPlatform, setImageProcessor } from '@craft-agent/server-core/services'
import { createApplicationMenu } from './menu'
import { WindowManager } from './window-manager'
import { loadWindowState, saveWindowState } from './window-state'
import { getWorkspaces, getWorkspaceByNameOrId, loadStoredConfig, addWorkspace, saveConfig } from '@craft-agent/shared/config'
import { getDefaultWorkspacesDir } from '@craft-agent/shared/workspaces'
import { initializeDocs } from '@craft-agent/shared/docs'
import { initializeReleaseNotes } from '@craft-agent/shared/release-notes'
import { ensureDefaultPermissions } from '@craft-agent/shared/agent/permissions-config'
import { ensureToolIcons, ensurePresetThemes } from '@craft-agent/shared/config'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { initializeBackendHostRuntime } from '@craft-agent/shared/agent/backend'
import { setPowerShellValidatorRoot } from '@craft-agent/shared/agent'
import { WRITER_ROOM_ID, type WriterArtifactKind, type WriterRoomPhase } from '@craft-agent/shared/writer-room'
import { handleDeepLink } from './deep-link'
import { BrowserPaneManager } from './browser-pane-manager'
import { OAuthFlowStore } from '@craft-agent/shared/auth'
import { registerThumbnailScheme, registerThumbnailHandler } from './thumbnail-protocol'
import log, { isDebugMode, mainLog, getLogFilePath, getMessagingGatewayLogFilePath, messagingGatewayLog } from './logger'
import { setPerfEnabled, enableDebug } from '@craft-agent/shared/utils'
import { registerPiModelResolver } from '@craft-agent/shared/config'
import { getPiModelsForAuthProvider, getAllPiModels } from '@craft-agent/shared/config'
import { initNotificationService, initBadgeIcon, initInstanceBadge, updateBadgeCount } from './notifications'
import { FlowBridge } from './lib/flow-bridge'
import { FlowWatcher } from './lib/flow-watcher'
import { showFlowNotification, initFlowNotifications } from './lib/flow-notifications'
import { abortChat, executeChat, type RegisteredProject } from './lib/epic-chat-agent'
import { applyPlan, executePlan, type PlanResult } from './lib/planning-agent'
import type { CodexSkillRunResult, FlowChatCommandType, FlowChatMessage, FlowGitInfo, FlowProjectContext, FlowUiState, SkillCrewImportSkillArgs, SkillCrewImportSkillResult, SkillFeedbackRecordInput, SkillMoment, SkillMomentCritique, SkillMomentFeedbackRecordInput, SkillMomentListInput, SkillMomentMedia, SkillMomentReaction, SkillMomentRunCycleInput, SkillMomentRunCycleResult, SkillMomentRunStatusEvent, SkillMomentSkillInput, SkillMomentSourceDigest } from '../shared/types'
import type { TaskStatus } from '../shared/flow-schemas'
import { checkForUpdatesOnLaunch, setAutoUpdateEventSink, isUpdating } from './auto-update'
import type { EventSink } from '@craft-agent/server-core/transport'
import { validateGitBashPath, checkVCRedistInstalled } from '@craft-agent/server-core/services'
import { getSkillCrewRoomPolicy, normalizeSkillMomentSlug } from './skill-crew/room-policies'
import { resolveAgentOSBrowserUseCapability } from './skill-crew/agentos-browser-use'
import {
  buildSkillActorMemoryRecords,
  type SkillActorMemoryRecord,
} from './skill-crew/skill-actor-memory'
import {
  executeRealSkillMomentCritiquePlans,
  executeRealSkillMomentPlans,
  realSkillMomentArtifacts,
  resolveSkillMomentExecutionMode,
  skillMomentInstructionFromLoadedSkill,
  type SkillMomentInstruction,
  type SkillMomentRealExecutionResult,
  type SkillMomentRealCritiquePublication,
  type SkillMomentRealPublication,
} from './skill-crew/skill-moments-real-execution'
import { runAgentOSBraveChatGptImagePrompt } from './skill-crew/agentos-browser-use-runner'
import {
  buildWriterRoomCritiqueBody,
  buildWriterRoomMockMomentBody,
  buildWriterRoomMomentPlans,
  WRITER_ROOM_MOCK_PHASES,
  writerArtifactTag,
} from './skill-crew/writer-room-mock'

// Initialize electron-log for renderer process support
log.initialize()

// Enable debug/perf in dev mode (running from source)
if (isDebugMode) {
  process.env.CRAFT_DEBUG = '1'
  enableDebug()
  setPerfEnabled(true)
}

// Bundle CLI tools: resolve platform-specific uv binary and wrapper scripts.
// These are available to all agent Bash sessions via CRAFT_UV, CRAFT_SCRIPTS env vars
// and PATH prepend. uv auto-downloads Python 3.12 on first use (~5s, then cached).
{
  // In packaged app: resources are at process.resourcesPath/app/resources/
  // In dev: resources are at __dirname/../resources/ (sibling of dist/)
  const resourcesBase = app.isPackaged
    ? join(process.resourcesPath, 'app')
    : join(__dirname, '..')
  const platformKey = `${process.platform}-${process.arch}`
  const uvPlatformDir = join(resourcesBase, 'resources', 'bin', platformKey)
  const uvBinary = join(uvPlatformDir, process.platform === 'win32' ? 'uv.exe' : 'uv')
  const binDir = join(resourcesBase, 'resources', 'bin')
  const scriptsDir = join(resourcesBase, 'resources', 'scripts')

  const bundledUvExists = existsSync(uvBinary)
  const fallbackUv = bundledUvExists ? null : 'uv'

  // Runtime resolver hints for shared session tools
  process.env.CRAFT_IS_PACKAGED = app.isPackaged ? '1' : '0'
  process.env.CRAFT_RESOURCES_BASE = resourcesBase
  process.env.CRAFT_APP_ROOT = resolveElectronAppRoot(app)

  process.env.CRAFT_UV = bundledUvExists ? uvBinary : (fallbackUv ?? uvBinary)

  // Bun runtime (packaged builds should prefer bundled runtime over PATH)
  const bunBinary = join(resourcesBase, 'vendor', 'bun', process.platform === 'win32' ? 'bun.exe' : 'bun')
  if (existsSync(bunBinary)) {
    process.env.CRAFT_BUN = bunBinary
  }

  process.env.CRAFT_SCRIPTS = scriptsDir
  process.env.CRAFT_COMMANDS_ENTRY = app.isPackaged
    ? join(app.getAppPath(), 'packages', 'craft-agents-commands', 'src', 'main.ts')
    : join(process.cwd(), 'packages', 'craft-agents-commands', 'src', 'main.ts')
  process.env.CRAFT_CLI_ENTRY = app.isPackaged
    ? join(app.getAppPath(), 'packages', 'craft-cli', 'src', 'cli.ts')
    : join(process.cwd(), 'packages', 'craft-cli', 'src', 'cli.ts')
  process.env.CRAFT_COMMANDS_DOC_PATH = app.isPackaged
    ? join(resourcesBase, 'resources', 'docs', 'craft-cli.md')
    : join(process.cwd(), 'apps', 'electron', 'resources', 'docs', 'craft-cli.md')
  process.env.CRAFT_CLI_DOC_PATH = process.env.CRAFT_COMMANDS_DOC_PATH
  process.env.CRAFT_AGENT_VERSION = app.getVersion()
  // Prepend both generic wrappers dir and platform uv dir:
  // - binDir exposes wrapper commands (pdf-tool, docx-tool, ...)
  // - uvPlatformDir exposes raw `uv` for direct shell usage / debugging
  process.env.PATH = `${binDir}${delimiter}${uvPlatformDir}${delimiter}${process.env.PATH}`

  if (!bundledUvExists) {
    mainLog.warn('Bundled uv binary missing, CLI document tools may fail unless uv is available on PATH.', {
      expectedUvPath: uvBinary,
      usingCraftUv: process.env.CRAFT_UV,
    })
  }

  if (isDebugMode) {
    mainLog.info('CLI tools configured:', { uvBinary: process.env.CRAFT_UV, binDir, scriptsDir, bundledUvExists })
  }
}

// Register Pi model resolver so llm-connections.ts can resolve Pi models
// without importing @mariozechner/pi-ai (which breaks the Vite renderer build)
registerPiModelResolver((piAuthProvider) =>
  piAuthProvider ? getPiModelsForAuthProvider(piAuthProvider) : getAllPiModels()
)

// Custom URL scheme for deeplinks (e.g., craftagents://auth-complete)
// Supports multi-instance dev: CRAFT_DEEPLINK_SCHEME env var (craftagents1, craftagents2, etc.)
const DEEPLINK_SCHEME = process.env.CRAFT_DEEPLINK_SCHEME || 'craftagents'

let windowManager: WindowManager | null = null
let sessionManager: SessionManager | null = null
let browserPaneManager: BrowserPaneManager | null = null
let oauthFlowStore: OAuthFlowStore | null = null
let moduleSink: EventSink | null = null
let moduleClientResolver: ((webContentsId: number) => string | undefined) | null = null
const flowBridges = new Map<string, FlowBridge>()
const flowWatchers = new Map<string, FlowWatcher>()
const pendingFlowPlans = new Map<string, PlanResult>()

// Messaging gateway: the bootstrap handle is created once sessionManager is
// available (inside createHandlerDeps) and populated with the WS publisher
// after bootstrapServer resolves. Both hosts (Electron + standalone) wire
// through createMessagingBootstrap — do not construct MessagingGatewayRegistry
// directly.
let messagingHandle: MessagingBootstrapHandle | null = null

// Store pending deep link if app not ready yet (cold start)
let pendingDeepLink: string | null = null

function getFlowBridge(workspaceRoot: string): FlowBridge {
  let bridge = flowBridges.get(workspaceRoot)
  if (!bridge) {
    bridge = new FlowBridge(workspaceRoot)
    flowBridges.set(workspaceRoot, bridge)
  }
  return bridge
}

function getFlowWindows(): BrowserWindow[] {
  return windowManager?.getAllWindows().map((managed) => managed.window) ?? BrowserWindow.getAllWindows()
}

function startFlowWatcher(workspaceRoot: string): void {
  if (flowWatchers.has(workspaceRoot)) return
  const watcher = new FlowWatcher(workspaceRoot, getFlowWindows)
  flowWatchers.set(workspaceRoot, watcher)
  watcher.start()
}

function stopFlowWatcher(workspaceRoot: string): void {
  const watcher = flowWatchers.get(workspaceRoot)
  if (!watcher) return
  watcher.stop()
  flowWatchers.delete(workspaceRoot)
}

function getSenderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
    ?? windowManager?.getWindowByWebContentsId(event.sender.id)
    ?? BrowserWindow.getFocusedWindow()
    ?? BrowserWindow.getAllWindows()[0]
    ?? null
}

function getPendingPlanKey(workspaceRoot: string, epicId: string): string {
  return `${workspaceRoot}\0${epicId}`
}

function execGit(dirPath: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', dirPath, ...args], { timeout: 5_000 }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      resolve(stdout.trim() || null)
    })
  })
}

async function getGitInfo(dirPath: string): Promise<FlowGitInfo> {
  const root = await execGit(dirPath, ['rev-parse', '--show-toplevel'])
  if (!root) {
    return { isGitRepo: false, root: null, branch: null }
  }
  const branch = await execGit(dirPath, ['branch', '--show-current'])
  return { isGitRepo: true, root, branch }
}

function readFlowProjectContext(workspaceRoot: string): FlowProjectContext {
  try {
    const packageJsonPath = join(workspaceRoot, 'package.json')
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { name?: string; description?: string }
      return {
        name: pkg.name || basename(workspaceRoot),
        description: pkg.description,
      }
    }
  } catch {
    // Fall through to basename fallback.
  }

  return { name: basename(workspaceRoot) }
}

function truncateForUi(text: string, max = 4000): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`
}

function resolveCodexCliPath(): string {
  const candidates = [
    process.env.CODEX_CLI_PATH,
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Users/gengrf/.local/bin/codex',
    'codex',
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (candidate === 'codex' || existsSync(candidate)) {
      return candidate
    }
  }

  return 'codex'
}

async function invalidateSkillCrewCache(): Promise<void> {
  try {
    const { invalidateSkillsCache } = await import('@craft-agent/shared/skills')
    invalidateSkillsCache()
  } catch (error) {
    mainLog.warn('Failed to invalidate skills cache after Codex skill run:', error)
  }
}

async function writeCodexSkillRunLog(args: {
  runId: string
  startedAt: string
  endedAt: string
  codexPath: string
  codexArgs: string[]
  workingDirectory: string
  success: boolean
  exitCode?: number | null
  error?: string
  stdout: string
  stderr: string
  text?: string
}): Promise<string | undefined> {
  try {
    const logDir = join(homedir(), '.craft-agent', 'logs', 'skill-crew-codex-runs')
    await mkdir(logDir, { recursive: true })
    const safeTimestamp = args.startedAt.replace(/[:.]/g, '-')
    const logPath = join(logDir, `${safeTimestamp}-${args.runId}.json`)
    await writeFile(logPath, JSON.stringify({
      startedAt: args.startedAt,
      endedAt: args.endedAt,
      workingDirectory: args.workingDirectory,
      codexPath: args.codexPath,
      codexArgs: args.codexArgs,
      success: args.success,
      exitCode: args.exitCode ?? null,
      error: args.error,
      stdout: args.stdout,
      stderr: args.stderr,
      text: args.text,
    }, null, 2), 'utf-8')
    return logPath
  } catch (error) {
    mainLog.warn('Failed to write Skill Crew Codex run log:', error)
    return undefined
  }
}

async function runCodexSkillExec(args: {
  prompt: string
  workingDirectory?: string
  model?: string
  timeoutMs?: number
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
}): Promise<CodexSkillRunResult> {
  const prompt = args.prompt?.trim()
  if (!prompt) {
    return { success: false, error: 'Empty Codex skill prompt' }
  }

  const workingDirectory = args.workingDirectory
    && args.workingDirectory !== 'user_default'
    && existsSync(args.workingDirectory)
    ? args.workingDirectory
    : homedir()
  const tempDir = await mkdtemp(join(tmpdir(), 'debt-codex-skill-'))
  const outputPath = join(tempDir, 'last-message.txt')
  const codexPath = resolveCodexCliPath()
  const runId = randomUUID().slice(0, 8)
  const startedAt = new Date().toISOString()
  const codexArgs = [
    'exec',
    '--cd', workingDirectory,
    '--skip-git-repo-check',
    '--output-last-message', outputPath,
  ]

  if (args.model?.trim()) {
    codexArgs.push('--model', args.model.trim())
  }
  if (args.reasoningEffort) {
    codexArgs.push('-c', `model_reasoning_effort="${args.reasoningEffort}"`)
  }
  codexArgs.push('-')
  const timeoutMs = args.timeoutMs === 0
    ? 0
    : Math.min(Math.max(args.timeoutMs ?? 3_000_000, 30_000), 86_400_000)
  const timeoutSeconds = Math.round(timeoutMs / 1000)

  return await new Promise<CodexSkillRunResult>((resolve) => {
    const child = spawn(codexPath, codexArgs, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        CODEX_HOME: process.env.CODEX_HOME || join(homedir(), '.codex'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = timeoutMs > 0 ? setTimeout(() => {
      if (settled) return
      settled = true
      if (child.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
        setTimeout(() => {
          try {
            process.kill(-child.pid!, 'SIGKILL')
          } catch {
            // The process may already have exited.
          }
        }, 5000)
      } else {
        child.kill('SIGTERM')
      }
      const error = `Codex CLI timed out after ${timeoutSeconds}s`
      void (async () => {
        const logPath = await writeCodexSkillRunLog({
          runId,
          startedAt,
          endedAt: new Date().toISOString(),
          codexPath,
          codexArgs,
          workingDirectory,
          success: false,
          error,
          stdout,
          stderr,
        })
        await invalidateSkillCrewCache()
        resolve({
          success: false,
          error,
          stdout: truncateForUi(stdout),
          stderr: truncateForUi(stderr),
          logPath,
        })
      })()
    }, timeoutMs) : undefined

    child.stdout?.setEncoding('utf-8')
    child.stderr?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      void (async () => {
        const logPath = await writeCodexSkillRunLog({
          runId,
          startedAt,
          endedAt: new Date().toISOString(),
          codexPath,
          codexArgs,
          workingDirectory,
          success: false,
          error: error.message,
          stdout,
          stderr,
        })
        await invalidateSkillCrewCache()
        resolve({
          success: false,
          error: error.message,
          stdout: truncateForUi(stdout),
          stderr: truncateForUi(stderr),
          logPath,
        })
      })()
    })
    child.on('close', async (code) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      try {
        const text = await readFile(outputPath, 'utf-8')
        const trimmedText = text.trim()
        const success = code === 0 && trimmedText.length > 0
        const error = code === 0 ? undefined : `Codex CLI exited with code ${code}`
        const logPath = await writeCodexSkillRunLog({
          runId,
          startedAt,
          endedAt: new Date().toISOString(),
          codexPath,
          codexArgs,
          workingDirectory,
          success,
          error,
          exitCode: code,
          stdout,
          stderr,
          text: trimmedText,
        })
        await invalidateSkillCrewCache()
        resolve({
          success,
          text: trimmedText,
          error,
          exitCode: code,
          stdout: truncateForUi(stdout),
          stderr: truncateForUi(stderr),
          logPath,
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const logPath = await writeCodexSkillRunLog({
          runId,
          startedAt,
          endedAt: new Date().toISOString(),
          codexPath,
          codexArgs,
          workingDirectory,
          success: false,
          error: errorMessage,
          exitCode: code,
          stdout,
          stderr,
        })
        await invalidateSkillCrewCache()
        resolve({
          success: false,
          error: errorMessage,
          exitCode: code,
          stdout: truncateForUi(stdout),
          stderr: truncateForUi(stderr),
          logPath,
        })
      } finally {
        void rm(tempDir, { recursive: true, force: true })
      }
    })

    child.stdin?.end(prompt)
  })
}

function skillFeedbackKind(verdict: SkillFeedbackRecordInput['verdict']) {
  if (verdict === 1) return 'evolve'
  if (verdict === 2) return 'unchanged'
  return 'regress'
}

async function recordSkillFeedbackSample(args: SkillFeedbackRecordInput): Promise<{ success: boolean; path: string }> {
  const workspace = getWorkspaceByNameOrId(args.workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${args.workspaceId}`)
  }

  if (![1, 2, 3].includes(args.verdict)) {
    throw new Error(`Invalid skill feedback verdict: ${args.verdict}`)
  }

  const feedbackDir = join(workspace.rootPath, 'evals')
  const feedbackPath = join(feedbackDir, 'feedback_samples.jsonl')
  const record = {
    schemaVersion: 1,
    source: 'debt.skill-crew.ui',
    recordedAt: args.recordedAt || new Date().toISOString(),
    sampleKind: skillFeedbackKind(args.verdict),
    verdict: args.verdict,
    skill: {
      id: args.skillId,
      name: args.skillName,
      handle: args.handle,
    },
    context: {
      workspaceId: args.workspaceId,
      channel: args.channel,
      branchId: args.branchId,
      messageId: args.messageId,
    },
    prompt: args.prompt,
    response: args.messageBody,
    artifacts: args.artifacts ?? [],
  }

  await mkdir(feedbackDir, { recursive: true })
  await appendFile(feedbackPath, `${JSON.stringify(record)}\n`, 'utf-8')
  return { success: true, path: feedbackPath }
}

type StoredSkillMoment = Omit<SkillMoment, 'critiques' | 'feedbackVerdict' | 'feedbackSavedPath'>
type StoredSkillMomentCritique = Omit<SkillMomentCritique, 'feedbackVerdict' | 'feedbackSavedPath'>
type SkillMomentRunStatusEmitter = (event: SkillMomentRunStatusEvent) => void

const skillMomentCycleLocks = new Set<string>()

function skillMomentsWorkspaceDir(rootPath: string) {
  return join(rootPath, 'skill-moments')
}

async function appendJsonlRecord(filePath: string, record: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf-8')
}

async function readJsonlRecords<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) {
    return []
  }

  const content = await readFile(filePath, 'utf-8')
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

function clampGraphemes(text: string, maxLength: number): string {
  const chars = Array.from(text.trim())
  if (chars.length <= maxLength) {
    return chars.join('')
  }
  return chars.slice(0, maxLength).join('')
}

function compactUniqueArtifacts(items: Array<string | undefined>): string[] {
  return Array.from(new Set(items.filter((item): item is string => Boolean(item))))
}

function seededRatio(seed: string): number {
  const digest = createHash('sha256').update(seed).digest()
  return digest.readUInt32BE(0) / 0xffffffff
}

function seededInt(seed: string, min: number, max: number): number {
  if (max <= min) {
    return min
  }
  return min + Math.floor(seededRatio(seed) * (max - min + 1))
}

function seededPick<T>(items: T[], seed: string): T {
  return items[seededInt(seed, 0, items.length - 1)]!
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  return items
    .map((item, index) => ({
      item,
      rank: seededRatio(`${seed}:${index}`),
    }))
    .sort((left, right) => left.rank - right.rank)
    .map(({ item }) => item)
}

function mockSkillMomentSourceDigests(runId: string, capturedAt: string): SkillMomentSourceDigest[] {
  return [
    {
      id: `${runId}-china-daily`,
      source: 'china_daily',
      title: 'China Daily RSS: technology and policy signal',
      url: 'https://usa.chinadaily.com.cn/rss.html',
      summary: 'Mock digest for China Daily RSS. Real adapter will read China, business, world, and opinion feeds.',
      publishedAt: capturedAt,
      capturedAt,
      status: 'mock',
    },
    {
      id: `${runId}-polymarket`,
      source: 'polymarket',
      title: 'Polymarket Gamma API: prediction market narrative signal',
      url: 'https://docs.polymarket.com/api-reference',
      summary: 'Mock digest for Polymarket market discovery. Real adapter will read active events and price-implied narratives.',
      publishedAt: capturedAt,
      capturedAt,
      status: 'mock',
    },
    {
      id: `${runId}-x`,
      source: 'x',
      title: 'X recent search: social attention signal',
      url: 'https://docs.x.com/x-api/posts/search/introduction',
      summary: 'Mock digest for X search. Real adapter will require a user-provided token and return unavailable when disabled.',
      publishedAt: capturedAt,
      capturedAt,
      status: 'mock',
    },
  ]
}

type MockSkillMomentPublication = {
  body: string
  artifacts?: string[]
  mediaPrompt?: string
  sceneBeat?: HomelanderFallenGodBeat
}

function formatHomelanderFallenGodMomentBody(
  skill: SkillMomentSkillInput,
  selection: HomelanderFallenGodMomentSelection,
): string {
  return [
    `${skill.handle} ${selection.template.visibility}`,
    selection.template.body,
  ].join('\n')
}

function buildHomelanderFallenGodMomentPublication(
  skill: SkillMomentSkillInput,
  index: number,
  roomId: string,
  cycleSeed?: string,
): MockSkillMomentPublication {
  const selection = selectHomelanderFallenGodMoment(
    `${cycleSeed ?? roomId}:homelander-fallen-god`,
    index,
  )

  return {
    body: formatHomelanderFallenGodMomentBody(skill, selection),
    artifacts: selection.artifacts,
    mediaPrompt: selection.mediaPrompt?.prompt,
    sceneBeat: selection.beat,
  }
}

function buildMockMomentBody(
  skill: SkillMomentSkillInput,
  digest: SkillMomentSourceDigest,
  index: number,
  roomId: string,
  artifactKind?: WriterArtifactKind,
  cycleSeed?: string,
): string {
  if (roomId === WRITER_ROOM_ID && artifactKind) {
    return buildWriterRoomMockMomentBody(skill, artifactKind)
  }

  const skillSlug = normalizeSkillMomentSlug(skill)
  if (skillSlug === 'homelander') {
    return buildHomelanderFallenGodMomentPublication(skill, index, roomId, cycleSeed).body
  }

  if (['ashley', 'atrain', 'black-noir', 'deep'].includes(skillSlug)) {
    return '<SILENCE/>'
  }

  if (skillSlug === 'butcher') {
    const butcherScenes = [
      [
        `${skill.handle} 仅屠夫小队可见`,
        '仓库灯一闪一闪，桌上摊着三张照片：塔楼侧门、热线名单、一个不敢露脸的证人。',
        '我想现在就去找他算账。先不急，今晚先让他自己把谎话说满。',
      ],
      [
        `${skill.handle} 仅屠夫小队可见`,
        '他在大屏上笑，底下有人把证词塞进我手里，纸边都被汗泡软了。',
        '祖国人爱镜头，那就给他镜头。等他笑到最亮的时候，把账本翻开。',
      ],
      [
        `${skill.handle} 仅屠夫小队可见`,
        '别在公开评论区骂他，没用。他就靠那点掌声活着。',
        '要报复，就拿证据报复。让每个给他鼓掌的人都看见签字那一页。',
      ],
    ]
    return seededPick(butcherScenes, `${cycleSeed ?? roomId}:butcher-scenes:${index}`).join('\n')
  }

  if (skillSlug === 'gazi') {
    const gaziScenes = [
      [
        `${skill.handle} 朋友圈`,
        '兄弟们先别上头，祖国人和屠夫这波吵得太满了，满屏都是火药味。',
        '我就问一句：名单、证人、退路，这三样没摆出来之前，谁冲谁都把握不住。',
      ],
      [
        `${skill.handle} 朋友圈`,
        '刚刷到祖国人把城市大屏切直播，排面确实猛。',
        '但家人们有一说一，越是这种大场面，越得先看谁拿证据、谁拿观众当垫脚石。',
      ],
    ]
    return seededPick(gaziScenes, `${cycleSeed ?? roomId}:gazi-scenes:${index}`).join('\n')
  }

  if (skillSlug === 'dongbei-yujie') {
    const yujieScenes = [
      [
        `${skill.handle} 朋友圈`,
        '哎呀我天，直播大屏一亮，楼下全举手机，场面整得挺带派。',
        '但姐说句实在的：热闹归热闹，谁家锅糊了谁知道。账本拿出来，别光让老铁们鼓掌。',
      ],
      [
        `${skill.handle} 朋友圈`,
        '刚才评论区吵起来了，祖国人一句话，屠夫一把火，旁边人全跟着上劲。',
        '老铁们先别站太快。灯越亮，灰越明显；谁怕查账，谁心里就有说道。',
      ],
    ]
    return seededPick(yujieScenes, `${cycleSeed ?? roomId}:dongbei-yujie-scenes:${index}`).join('\n')
  }

  if (skillSlug === 'liu-haizhu') {
    const liuScenes = [
      [
        `${skill.handle} 朋友圈`,
        '厂门口那盏黄灯一闪一闪的，几个老实人围着手机看祖国人直播，谁也不敢先骂。',
        '我刘海柱就问一句：谁被他压住了，谁又被屠夫当成刀使了？面子归面子，账归账。',
      ],
      [
        `${skill.handle} 朋友圈`,
        '楼道里有人把偷拍视频递过来，手抖得厉害，说只求别再被点名。',
        '这事儿不讲究。祖国人要掌声，屠夫要报复，我先看谁欺负老实人。',
      ],
    ]
    return seededPick(liuScenes, `${cycleSeed ?? roomId}:liu-haizhu-scenes:${index}`).join('\n')
  }

  if (skillSlug === 'chomsky') {
    return [
      `${skill.handle} 朋友圈`,
      `我读到「${digest.title}」。先别急着追热点，先问这套话是谁写的、谁反复播放、谁因此保持沉默。`,
      '如果答案只剩一个口号，那不是解释，是宣传。',
    ].join('\n')
  }

  const thesis = [
    '热点不是结论，必须变成一个可验证的行动假设。',
    '真正有价值的信号，是媒体叙事、市场赔率和社交注意力之间的裂缝。',
    '如果一个观点没有来源、边界和反证入口，它只适合当素材，不适合当判断。',
  ][index % 3]

  return [
    `${skill.handle} 朋友圈`,
    `我读到「${digest.title}」后的判断：${thesis}`,
    '我先把它当成一个待验证的问题，不当结论。',
    '先放这里，等你们挑刺。',
  ].join('\n')
}

function buildMockMomentPublication(
  skill: SkillMomentSkillInput,
  digest: SkillMomentSourceDigest,
  index: number,
  roomId: string,
  artifactKind?: WriterArtifactKind,
  cycleSeed?: string,
): MockSkillMomentPublication {
  if (roomId !== WRITER_ROOM_ID && normalizeSkillMomentSlug(skill) === 'homelander') {
    return buildHomelanderFallenGodMomentPublication(skill, index, roomId, cycleSeed)
  }

  return {
    body: buildMockMomentBody(skill, digest, index, roomId, artifactKind, cycleSeed),
  }
}

function buildMockCritiqueBody(
  author: SkillMomentSkillInput,
  critic: SkillMomentSkillInput,
  index: number,
  roomId: string,
  artifactKind?: WriterArtifactKind,
  sceneBeat?: HomelanderFallenGodBeat,
  cycleSeed?: string,
): string {
  if (roomId === WRITER_ROOM_ID) {
    return buildWriterRoomCritiqueBody(critic, index, artifactKind)
  }

  const authorSlug = normalizeSkillMomentSlug(author)
  const criticSlug = normalizeSkillMomentSlug(critic)
  const pickCritique = (lines: string[], maxLength = 120) => clampGraphemes(
    seededPick(lines, `${authorSlug}:${criticSlug}:${index}`),
    maxLength,
  )

  if (authorSlug === 'homelander' && sceneBeat) {
    const scenePackBody = pickHomelanderFallenGodCritiqueBody(
      criticSlug,
      `${cycleSeed ?? sceneBeat.id}:${sceneBeat.id}:${criticSlug}:${index}`,
    )
    if (scenePackBody) {
      return clampGraphemes(scenePackBody, 120)
    }
  }

  if (authorSlug === 'homelander' && criticSlug === 'butcher') {
    return pickCritique([
      '开直播，我带证人。',
      '原片我看，剪辑师我也找。别只会把灯打到自己脸上。',
      '你敢放名单，我就敢把第一个名字念出来。猜猜是谁签的字？',
    ])
  }

  if (authorSlug === 'homelander' && criticSlug === 'ashley') {
    return pickCritique([
      '口径已统一，别自由发挥。',
      '先生，建议把“名单”改成“安全清单”。法务已经开始尖叫了。',
      '所有账号照这一版转：先说城市安全，再说您亲自出面，最后不要提热线是谁接。',
    ])
  }

  if (authorSlug === 'homelander' && criticSlug === 'atrain') {
    return pickCritique([
      'Big moment，已编辑。',
      '我转了，配速很快。上一版截图别用了，角度显得我们像在撤。',
      '先生我可以跑一圈把热搜带起来，但别让我站名单旁边，那个画面不利于赞助。',
    ])
  }

  if (authorSlug === 'homelander' && criticSlug === 'black-noir') {
    return pickCritique([
      '已点赞。',
      '已点赞，已转发。',
      '黑色手套比了个赞。',
    ])
  }

  if (authorSlug === 'homelander' && criticSlug === 'deep') {
    return pickCritique([
      '我马上转发，真的。',
      '先生我刚才已经点了赞，可能网络慢，不是我犹豫。',
      '我觉得海边也可以拍一版，人民会喜欢自然、力量、还有您。',
    ])
  }

  if (authorSlug === 'homelander' && criticSlug === 'starlight') {
    return pickCritique([
      '灯太亮，阴影也在。',
      '如果你真的有证据，就别把群众放在镜头前当盾牌。',
      '你把城市叫观众，他们只是想安全回家。照片里看不到的人，不等于不存在。',
    ])
  }

  if (authorSlug === 'homelander' && criticSlug === 'gazi') {
    return pickCritique([
      '哥，这镜头太冲了。',
      '哥，排面是有了，但名单这玩意儿别乱点，点错一个人就炸锅。',
      '这张要是配货我都知道咋卖：先立规矩，再让人抢前排。但你这个前排有点吓人。',
    ])
  }

  if (authorSlug === 'homelander' && criticSlug === 'dongbei-yujie') {
    return pickCritique([
      '排面行，账也得清。',
      '哎呀我天，这场面整得挺大。但姐说句实在的，灯越亮，灰越明显。',
      '老铁们爱看热闹，可谁家锅糊了谁知道。你别光摆拍，账本也得翻。',
    ])
  }

  if (authorSlug === 'homelander' && criticSlug === 'liu-haizhu') {
    return pickCritique([
      '灯底下还有人呢。',
      '你在天台上说城市发抖，底下人是真冷。先把话说给他们听。',
      '我刘海柱就问一句：你要名单，还是要真相？别拿镜头压人。',
    ])
  }

  if (authorSlug === 'homelander' && criticSlug === 'chomsky') {
    return pickCritique([
      '谁剪掉了反画面？',
      '这不是证据发布，这是注意力占领。',
      '当每个屏幕只播放同一张脸，问题就不是谁在说话，而是谁被迫沉默。',
    ])
  }

  if (authorSlug === 'homelander' && criticSlug === 'hayek') {
    return pickCritique([
      '恐惧不是价格信号。',
      '名单无法替代规则。没有反证通道，所有掌声都会失真。',
      '如果每个人都因为惧怕而转发，你得到的不是偏好，只是被污染的信号。',
    ])
  }

  if (authorSlug === 'homelander' && criticSlug === 'sun') {
    return pickCritique([
      '爆点够，代价谁付？',
      '流量很猛，但你得把冲突变成可持续叙事，不然明天就只剩危机公关。',
      '这条能上热搜。问题是上完热搜以后，是转化成阵营，还是转化成调查？',
    ])
  }

  if (authorSlug === 'butcher' && criticSlug === 'homelander') {
    return pickCritique([
      'William，别把报复说得像正义。你要账本，我要镜头；区别是，全城会先看见我的脸。',
      '你躲在“仅可见”里磨刀，我站在大屏前微笑。孩子，掌声永远知道谁像神。',
      '你可以念我的名字。每念一次，观众就更想看你下跪。',
    ])
  }

  if (authorSlug === 'gazi' && criticSlug === 'homelander') {
    return pickCritique([
      '把握不住的是他们，不是我。',
      '兄弟这个词很温暖。可惜观众需要的是神，不是劝酒的人。',
    ])
  }

  if (authorSlug === 'gazi' && criticSlug === 'butcher') {
    return pickCritique([
      '嘎子，少劝两句。真怕炸锅，就把锅盖掀开看看下面是谁。',
      '账本我来找，你负责别让那帮人又被直播骗了。',
    ])
  }

  if (authorSlug === 'dongbei-yujie' && criticSlug === 'homelander') {
    return pickCritique([
      '雨姐，灯亮是因为我来了。',
      '灰尘不怕光。怕光的是藏在厨房里编故事的人。',
    ])
  }

  if (authorSlug === 'dongbei-yujie' && criticSlug === 'butcher') {
    return pickCritique([
      '姐说得对，账本拿出来。别让他拿掌声当锅盖。',
      '热闹不是问题，问题是有人用热闹埋尸体。',
    ])
  }

  if (authorSlug === 'liu-haizhu' && criticSlug === 'homelander') {
    return pickCritique([
      '刘海柱，别把弱者挂在嘴边。真正保护他们的人会站在天上。',
      '你问谁被压住了？抬头看看，是谁把城市从恐惧里托起来。',
    ])
  }

  if (authorSlug === 'liu-haizhu' && criticSlug === 'butcher') {
    return pickCritique([
      '柱子，这句我认：先看谁欺负老实人。',
      '他要掌声，我要他的签字。你看住人，我去翻账。',
    ])
  }

  if (criticSlug === 'homelander') {
    return clampGraphemes('孩子，掌声会给答案。', 20)
  }

  if (authorSlug === 'homelander') {
    return pickCritique([
      '这场面太好操纵。',
      '谁在镜头外？',
      '评论区已经开始站队了。',
    ], 40)
  }

  if (criticSlug === 'chomsky') {
    return clampGraphemes('谁掌权，先说清。', 20)
  }

  const authorQuestions: Record<string, string[]> = {
    butcher: [
      '你手里有账本吗？',
      '先查谁的钱？',
      '别只骂，证据呢？',
    ],
    chomsky: [
      '谁在播这套话？',
      '沉默的人是谁？',
      '这口号谁受益？',
    ],
  }
  const questions = authorQuestions[authorSlug] ?? [
    '所以下一步查啥？',
    '这事谁会买单？',
    '有没有反例？',
    '谁最怕这结论？',
    '用户会怎么用？',
    '这能落地吗？',
  ]
  return clampGraphemes(questions[index % questions.length]!, 20)
}

function shouldAttachSkillMomentSource(author: SkillMomentSkillInput, roomId: string): boolean {
  if (roomId === WRITER_ROOM_ID) {
    return false
  }

  const authorSlug = normalizeSkillMomentSlug(author)
  return !['homelander', 'butcher', 'gazi', 'dongbei-yujie', 'liu-haizhu'].includes(authorSlug)
}

type SkillMomentPlan = {
  author: SkillMomentSkillInput
  artifactKind?: WriterArtifactKind
}

function buildDefaultSkillMomentPlans(
  roomId: string,
  eligibleSkills: SkillMomentSkillInput[],
  maxMoments: number,
  cycleSeed?: string,
): SkillMomentPlan[] {
  if (roomId === WRITER_ROOM_ID) {
    return buildWriterRoomMomentPlans(eligibleSkills, defaultSkillMomentParticipants(), maxMoments)
  }

  if (roomId === 'debate') {
    const bySlug = new Map(eligibleSkills.map((skill) => [normalizeSkillMomentSlug(skill), skill]))
    const planned: SkillMomentSkillInput[] = []
    const addUnique = (skill?: SkillMomentSkillInput) => {
      if (skill && !planned.includes(skill) && planned.length < maxMoments) {
        planned.push(skill)
      }
    }
    const addAny = (skill?: SkillMomentSkillInput) => {
      if (skill && planned.length < maxMoments) {
        planned.push(skill)
      }
    }

    const homelander = bySlug.get('homelander')
    addAny(homelander)
    addUnique(bySlug.get('butcher'))
    for (const skill of seededShuffle([
      bySlug.get('dongbei-yujie'),
      bySlug.get('gazi'),
      bySlug.get('liu-haizhu'),
    ].filter(Boolean) as SkillMomentSkillInput[], `${cycleSeed ?? roomId}:social-posters`)) {
      addUnique(skill)
      if (planned.length < maxMoments && homelander && seededRatio(`${cycleSeed ?? roomId}:homelander-repeat:${skill.id}`) > 0.55) {
        addAny(homelander)
      }
    }
    while (planned.length < Math.min(maxMoments, 3) && homelander) {
      addAny(homelander)
    }
    for (const skill of eligibleSkills) {
      addUnique(skill)
    }

    return planned.map((author) => ({ author }))
  }

  return eligibleSkills.slice(0, maxMoments).map((author) => ({ author }))
}

function maybeGetSkillBySlug(skills: SkillMomentSkillInput[], slug: string): SkillMomentSkillInput | undefined {
  return skills.find((skill) => normalizeSkillMomentSlug(skill) === slug)
}

function selectDebateCriticsForMoment(
  author: SkillMomentSkillInput,
  eligibleSkills: SkillMomentSkillInput[],
  orderedCritics: SkillMomentSkillInput[],
  maxCritics: number,
  seed: string,
): SkillMomentSkillInput[] {
  if (maxCritics <= 0) {
    return []
  }

  const authorSlug = normalizeSkillMomentSlug(author)
  if (authorSlug !== 'homelander') {
    const count = seededInt(`${seed}:critic-count`, 1, maxCritics)
    const picked: SkillMomentSkillInput[] = []
    const add = (skill?: SkillMomentSkillInput) => {
      if (skill && !picked.includes(skill) && picked.length < count) {
        picked.push(skill)
      }
    }

    if (authorSlug === 'butcher') {
      add(maybeGetSkillBySlug(orderedCritics, 'homelander'))
    }
    if (['dongbei-yujie', 'gazi', 'liu-haizhu'].includes(authorSlug)) {
      const mainConflictReplies = [
        maybeGetSkillBySlug(orderedCritics, 'homelander'),
        maybeGetSkillBySlug(orderedCritics, 'butcher'),
      ].filter(Boolean) as SkillMomentSkillInput[]
      if (mainConflictReplies.length > 0) {
        add(seededPick(mainConflictReplies, `${seed}:main-conflict-reply`))
      }
    }
    for (const critic of seededShuffle(orderedCritics, `${seed}:critic-order`)) {
      add(critic)
    }
    return picked
  }

  const bySlug = new Map(eligibleSkills.map((skill) => [normalizeSkillMomentSlug(skill), skill]))
  const voughtSlugs = ['ashley', 'atrain', 'black-noir', 'deep']
  const counterSlugs = ['butcher', 'starlight', 'liu-haizhu', 'gazi', 'dongbei-yujie', 'chomsky', 'hayek', 'sun']
  const socialSlugs = ['liu-haizhu', 'gazi', 'dongbei-yujie']
  const vought = seededShuffle(voughtSlugs.map((slug) => bySlug.get(slug)).filter(Boolean) as SkillMomentSkillInput[], `${seed}:vought`)
  const counters = seededShuffle(counterSlugs.map((slug) => bySlug.get(slug)).filter(Boolean) as SkillMomentSkillInput[], `${seed}:counter`)
  const social = seededShuffle(socialSlugs.map((slug) => bySlug.get(slug)).filter(Boolean) as SkillMomentSkillInput[], `${seed}:social`)
  const fallback = seededShuffle(orderedCritics.filter((critic) => (
    !vought.includes(critic) && !counters.includes(critic)
  )), `${seed}:fallback`)
  const targetCount = seededInt(`${seed}:critic-count`, Math.min(2, maxCritics), maxCritics)
  const picked: SkillMomentSkillInput[] = []

  if (vought.length) {
    picked.push(vought[0]!)
  }
  const butcher = bySlug.get('butcher')
  if (picked.length < targetCount && butcher) {
    picked.push(butcher)
  }
  if (picked.length < targetCount && social.length) {
    picked.push(social[0]!)
  }

  for (const critic of seededShuffle([...vought.slice(1), ...counters.slice(1), ...fallback], `${seed}:rest`)) {
    if (picked.length >= targetCount) {
      break
    }
    if (!picked.includes(critic)) {
      picked.push(critic)
    }
  }

  return picked
}

function reactionFromSkill(skill: SkillMomentSkillInput, createdAt: string): SkillMomentReaction {
  return {
    skillId: skill.id,
    skillName: skill.name,
    handle: skill.handle,
    kind: 'like',
    createdAt,
  }
}

function buildMockMomentReactions(
  author: SkillMomentSkillInput,
  eligibleSkills: SkillMomentSkillInput[],
  seed: string,
  createdAt: string,
): SkillMomentReaction[] {
  const authorSlug = normalizeSkillMomentSlug(author)
  const bySlug = new Map(eligibleSkills.map((skill) => [normalizeSkillMomentSlug(skill), skill]))
  const likerSlugs = authorSlug === 'homelander'
    ? ['black-noir', 'ashley', 'atrain', 'deep']
    : authorSlug === 'butcher'
      ? ['starlight', 'liu-haizhu', 'gazi']
      : ['gazi', 'dongbei-yujie', 'liu-haizhu', 'butcher'].filter((slug) => slug !== authorSlug)
  const candidates = likerSlugs.map((slug) => bySlug.get(slug)).filter(Boolean) as SkillMomentSkillInput[]
  if (candidates.length === 0) {
    return []
  }

  const count = seededInt(`${seed}:reaction-count`, 1, Math.min(3, candidates.length))
  return seededShuffle(candidates, `${seed}:reaction-order`)
    .slice(0, count)
    .map((skill) => reactionFromSkill(skill, createdAt))
}

function buildMockCritiqueReactions(
  author: SkillMomentSkillInput,
  critic: SkillMomentSkillInput,
  eligibleSkills: SkillMomentSkillInput[],
  seed: string,
  createdAt: string,
): SkillMomentReaction[] {
  const authorSlug = normalizeSkillMomentSlug(author)
  const criticSlug = normalizeSkillMomentSlug(critic)
  const bySlug = new Map(eligibleSkills.map((skill) => [normalizeSkillMomentSlug(skill), skill]))
  const likerSlugs = criticSlug === 'homelander'
    ? ['ashley', 'atrain', 'black-noir', 'deep']
    : criticSlug === 'butcher'
      ? ['starlight', 'liu-haizhu']
      : ['dongbei-yujie', 'gazi', 'liu-haizhu'].filter((slug) => slug !== criticSlug)
  const candidates = likerSlugs
    .filter((slug) => slug !== authorSlug)
    .map((slug) => bySlug.get(slug))
    .filter(Boolean) as SkillMomentSkillInput[]

  if (candidates.length === 0 || seededRatio(`${seed}:should-like`) < 0.35) {
    return []
  }

  return [reactionFromSkill(seededPick(candidates, `${seed}:liker`), createdAt)]
}

function buildHomelanderCounterReply(
  author: SkillMomentSkillInput,
  selectedCritics: SkillMomentSkillInput[],
  parentMomentId: string,
  planIndex: number,
  createdAt: string,
  eligibleSkills: SkillMomentSkillInput[],
): SkillMomentCritique | undefined {
  if (normalizeSkillMomentSlug(author) !== 'homelander') {
    return undefined
  }
  if (!selectedCritics.some((critic) => normalizeSkillMomentSlug(critic) === 'butcher')) {
    return undefined
  }

  const body = seededPick([
    'William，你每次骂我，都像在帮我打广告。继续，我会把灯打得更亮一点。',
    '你说有证人？好啊。把他带到镜头前。别忘了，人群最爱看害怕的人撒谎。',
    '屠夫，评论区很安全，对吧？来大屏前说。让孩子们看看你所谓的勇气有没有声音。',
  ], `${parentMomentId}:homelander-counter:${planIndex}`)
  return {
    id: `${parentMomentId}-critic-homelander-reply`,
    parentMomentId,
    criticSkillId: author.id,
    criticSkillName: author.name,
    criticHandle: author.handle,
    body,
    createdAt,
    reactions: buildMockCritiqueReactions(author, author, eligibleSkills, `${parentMomentId}:homelander-counter-reactions`, createdAt),
    artifacts: ['agentos_mock_critic', 'homelander_counterreply', 'threaded_conflict'],
  }
}

function isAgentOSBrowserMediaDisabled(): boolean {
  const normalized = process.env.CRAFT_AGENTOS_BROWSER_MEDIA?.trim().toLocaleLowerCase()
  return normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'disabled' || normalized === 'none'
}

function buildHomelanderMediaPrompt(body: string, seed: string): { prompt: string; alt: string; theme: string } {
  const scenes = [
    {
      theme: 'selfie',
      alt: '祖国人式超级英雄在城市高处自拍',
      visual: 'front-camera social-media selfie from a city rooftop at night, skyline below, phone held slightly too close, triumphant smile, dramatic wind',
    },
    {
      theme: 'tower_screen',
      alt: '塔楼大屏播放祖国人式超级英雄画面',
      visual: 'corporate tower plaza with a huge public screen showing the hero, phones raised in the crowd, crisis-media spectacle, night lights',
    },
    {
      theme: 'city_hall',
      alt: '市政厅台阶前的祖国人式超级英雄',
      visual: 'city hall steps crowded with reporters and camera flashes, the hero standing above microphones, tense public confrontation',
    },
    {
      theme: 'skybridge',
      alt: '玻璃天桥上的祖国人式超级英雄',
      visual: 'glass skybridge above a city crowd, the hero looking down while people hold phones, vertigo, public vote energy',
    },
    {
      theme: 'hotline_room',
      alt: '危机热线办公室里的祖国人式超级英雄',
      visual: 'late-night crisis hotline room, ringing phones, wall screens, the hero lit by monitors, controlled intimidation',
    },
    {
      theme: 'rally',
      alt: '夜间集会上的祖国人式超级英雄',
      visual: 'night rally scene with flags as abstract color blocks, cheering and worried faces mixed, the hero framed like a celebrity politician',
    },
  ]
  const scene = seededPick(scenes, `${seed}:media-scene`)
  const prompt = [
    'Create a new image now using ChatGPT image generation. Do not search files, do not answer with text only, and do not ask follow-up questions.',
    'Generate one cinematic social-media image for a fictional superhero satire feed.',
    `Post context: ${body.replace(/\s+/g, ' ').slice(0, 500)}`,
    `Scene: ${scene.visual}.`,
    'Character: a blond authoritarian superhero celebrity with patriotic red, white, and blue visual language, powerful public-image energy, not a replica of any actor likeness, no official logos, no readable text, no watermark.',
    'Style: realistic cinematic phone-feed image, dramatic but crisp, usable as a朋友圈 post image, 4:5 vertical composition.',
  ].join('\n')

  return {
    prompt,
    alt: scene.alt,
    theme: scene.theme,
  }
}

function buildSkillActorMediaPrompt(args: {
  author: SkillMomentSkillInput
  body: string
  mediaPrompt: string
}): { prompt: string; alt: string; theme: string } {
  const slug = normalizeSkillMomentSlug(args.author)
  return {
    theme: `${slug}-actor-request`,
    alt: `${args.author.name || args.author.handle} 朋友圈配图`,
    prompt: [
      'Create a new image now using ChatGPT image generation. Do not search files, do not answer with text only, and do not ask follow-up questions.',
      'Generate one cinematic social-media image for a fictional persona feed.',
      `Post author: ${args.author.name} ${args.author.handle}`,
      `Post context: ${args.body.replace(/\s+/g, ' ').slice(0, 500)}`,
      `Image request: ${args.mediaPrompt.replace(/\s+/g, ' ').slice(0, 700)}`,
      'Style: realistic cinematic phone-feed image, dramatic but crisp, 4:5 vertical composition, visible story tension, no readable text, no logos, no watermark.',
      'Safety: fictionalized persona depiction only, no celebrity likeness, no actor likeness, no real-person impersonation.',
    ].join('\n'),
  }
}

async function maybeGenerateSkillActorRequestedMedia(args: {
  author: SkillMomentSkillInput
  body: string
  mediaPrompt?: string
  roomId: string
  momentId: string
  momentsDir: string
  createdAt: string
  browserUse: ReturnType<typeof resolveAgentOSBrowserUseCapability>
  emitStatus?: SkillMomentRunStatusEmitter
  workspaceId: string
  runId: string
}): Promise<{ media: SkillMomentMedia[]; source?: SkillMomentSourceDigest; error?: string }> {
  if (
    !args.mediaPrompt
    || args.roomId === WRITER_ROOM_ID
    || isAgentOSBrowserMediaDisabled()
  ) {
    return { media: [] }
  }

  if (!args.browserUse.enabled) {
    args.emitStatus?.({
      workspaceId: args.workspaceId,
      roomId: args.roomId,
      runId: args.runId,
      phase: 'browser_error',
      message: '跳过 actor 配图',
      detail: args.browserUse.reason || 'AgentOS Browser Use unavailable',
      createdAt: new Date().toISOString(),
    })
    return { media: [], error: args.browserUse.reason || 'AgentOS Browser Use unavailable' }
  }

  const mediaPlan = buildSkillActorMediaPrompt({
    author: args.author,
    body: args.body,
    mediaPrompt: args.mediaPrompt,
  })
  args.emitStatus?.({
    workspaceId: args.workspaceId,
    roomId: args.roomId,
    runId: args.runId,
    phase: 'media_prompt',
    message: `已准备 ${args.author.name || args.author.handle} 配图提示词`,
    detail: '由 skill actor decision.media_prompt 触发。',
    createdAt: new Date().toISOString(),
  })

  const mediaPath = join(args.momentsDir, 'media', `${args.momentId}-${mediaPlan.theme}.png`)
  const configuredWaitMs = Number(process.env.CRAFT_AGENTOS_BROWSER_MEDIA_WAIT_MS)
  const result = await runAgentOSBraveChatGptImagePrompt({
    prompt: mediaPlan.prompt,
    outputPath: mediaPath,
    waitForImageMs: Number.isFinite(configuredWaitMs) && configuredWaitMs > 0
      ? configuredWaitMs
      : 300_000,
    onStatus: (status) => args.emitStatus?.({
      workspaceId: args.workspaceId,
      roomId: args.roomId,
      runId: args.runId,
      phase: status.phase,
      message: status.message,
      detail: status.detail,
      createdAt: new Date().toISOString(),
    }),
  })

  if (!result.success || !result.imagePath) {
    return { media: [], error: result.error || 'ChatGPT image was not captured from Brave' }
  }

  const source: SkillMomentSourceDigest = {
    id: `${args.momentId}-chatgpt-actor-image`,
    source: 'manual',
    title: `ChatGPT image via AgentOS Brave runner: ${mediaPlan.theme}`,
    url: result.conversationUrl || 'https://chatgpt.com/',
    summary: 'AgentOS used a Skill Actor media_request decision to send a ChatGPT image prompt through Brave and captured the generated image from the visible page.',
    capturedAt: args.createdAt,
    status: 'ready',
  }

  return {
    source,
    media: [{
      id: `${args.momentId}-image-1`,
      type: 'image',
      path: result.imagePath,
      mimeType: 'image/png',
      alt: mediaPlan.alt,
      sourceUrl: result.conversationUrl,
      width: result.imageWidth,
      height: result.imageHeight,
    }],
  }
}

async function maybeGenerateHomelanderMomentMedia(args: {
  author: SkillMomentSkillInput
  body: string
  roomId: string
  momentId: string
  momentsDir: string
  createdAt: string
  browserUse: ReturnType<typeof resolveAgentOSBrowserUseCapability>
  emitStatus?: SkillMomentRunStatusEmitter
  workspaceId: string
  runId: string
}): Promise<{ media: SkillMomentMedia[]; source?: SkillMomentSourceDigest; error?: string }> {
  if (
    args.roomId === WRITER_ROOM_ID
    || normalizeSkillMomentSlug(args.author) !== 'homelander'
    || isAgentOSBrowserMediaDisabled()
  ) {
    return { media: [] }
  }

  if (!args.browserUse.enabled) {
    args.emitStatus?.({
      workspaceId: args.workspaceId,
      roomId: args.roomId,
      runId: args.runId,
      phase: 'browser_error',
      message: '跳过 Brave 生图',
      detail: args.browserUse.reason || 'AgentOS Browser Use unavailable',
      createdAt: new Date().toISOString(),
    })
    return { media: [], error: args.browserUse.reason || 'AgentOS Browser Use unavailable' }
  }

  const mediaPlan = buildHomelanderMediaPrompt(args.body, args.momentId)
  args.emitStatus?.({
    workspaceId: args.workspaceId,
    roomId: args.roomId,
    runId: args.runId,
    phase: 'media_prompt',
    message: '已准备祖国人配图提示词',
    detail: `主题：${mediaPlan.theme}。下一步复用或打开 Brave。`,
    createdAt: new Date().toISOString(),
  })
  const mediaPath = join(args.momentsDir, 'media', `${args.momentId}-${mediaPlan.theme}.png`)
  const configuredWaitMs = Number(process.env.CRAFT_AGENTOS_BROWSER_MEDIA_WAIT_MS)
  const result = await runAgentOSBraveChatGptImagePrompt({
    prompt: mediaPlan.prompt,
    outputPath: mediaPath,
    waitForImageMs: Number.isFinite(configuredWaitMs) && configuredWaitMs > 0
      ? configuredWaitMs
      : 300_000,
    onStatus: (status) => args.emitStatus?.({
      workspaceId: args.workspaceId,
      roomId: args.roomId,
      runId: args.runId,
      phase: status.phase,
      message: status.message,
      detail: status.detail,
      createdAt: new Date().toISOString(),
    }),
  })

  if (!result.success || !result.imagePath) {
    return { media: [], error: result.error || 'ChatGPT image was not captured from Brave' }
  }

  const source: SkillMomentSourceDigest = {
    id: `${args.momentId}-chatgpt-image`,
    source: 'manual',
    title: `ChatGPT image via AgentOS Brave runner: ${mediaPlan.theme}`,
    url: result.conversationUrl || 'https://chatgpt.com/',
    summary: 'AgentOS used Brave Browser to send a ChatGPT image prompt for this Homelander-style Skill Moment and captured the generated image from the visible page.',
    capturedAt: args.createdAt,
    status: 'ready',
  }

  return {
    source,
    media: [{
      id: `${args.momentId}-image-1`,
      type: 'image',
      path: result.imagePath,
      mimeType: 'image/png',
      alt: mediaPlan.alt,
      sourceUrl: result.conversationUrl,
      width: result.imageWidth,
      height: result.imageHeight,
    }],
  }
}

function defaultSkillMomentParticipants(): SkillMomentSkillInput[] {
  return [
    {
      id: 'hayek',
      name: 'hayek',
      handle: '@hayek',
      description: '从价格信号、分散知识和制度约束视角审视机会。',
    },
    {
      id: 'sun',
      name: 'sun',
      handle: '@sun',
      description: '从叙事、增长、流量和市场注意力视角寻找机会。',
    },
  ]
}

function isWorkspaceSkillInRoom(skillPath: string, workspaceRoot: string, roomId: string): boolean {
  const roomRoot = join(workspaceRoot, 'skills', roomId)
  const rel = relative(roomRoot, skillPath)
  return !!rel && rel !== '..' && !rel.startsWith('..') && !rel.startsWith('/')
}

async function resolveSkillMomentParticipants(args: SkillMomentRunCycleInput, workspaceRoot: string, roomId: string): Promise<SkillMomentSkillInput[]> {
  const explicitSkills = (args.skills ?? [])
    .filter((skill) => skill.id && skill.handle)
    .filter((skill) => skill.id !== '__chairman__' && skill.id !== 'chairman')
  if (explicitSkills.length > 0) {
    return explicitSkills
  }

  try {
    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    const loadedSkills = loadAllSkills(workspaceRoot, args.workingDirectory)
      .filter((skill) => skill.slug !== 'chairman')
      .filter((skill) => !args.skillSlugs?.length || args.skillSlugs.includes(skill.slug))
    const roomSkills = loadedSkills.filter((skill) => isWorkspaceSkillInRoom(skill.path, workspaceRoot, roomId))
    const selected = roomSkills.length > 0 ? roomSkills : loadedSkills
    const participants = selected.map((skill): SkillMomentSkillInput => ({
      id: skill.slug,
      name: skill.metadata.name || skill.slug,
      handle: `@${skill.slug}`,
      description: skill.metadata.description || '',
    }))
    if (participants.length > 0) {
      return participants
    }
  } catch (error) {
    mainLog.warn('Failed to resolve Skill Moment participants from workspace skills:', error)
  }

  const fallback = defaultSkillMomentParticipants()
  return args.skillSlugs?.length
    ? fallback.filter((skill) => args.skillSlugs!.includes(skill.id))
    : fallback
}

async function loadSkillMomentInstructions(workspaceRoot: string, workingDirectory?: string): Promise<SkillMomentInstruction[]> {
  try {
    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    return loadAllSkills(workspaceRoot, workingDirectory).map(skillMomentInstructionFromLoadedSkill)
  } catch (error) {
    mainLog.warn('Failed to load Skill Moment SKILL.md instructions:', error)
    return []
  }
}

async function readRecentSkillMomentHistory(
  momentsPath: string,
  criticsPath: string,
  roomId: string,
): Promise<{ moments: SkillMoment[]; critiques: SkillMomentCritique[] }> {
  const storedMoments = await readJsonlRecords<StoredSkillMoment>(momentsPath)
  const storedCritics = await readJsonlRecords<StoredSkillMomentCritique>(criticsPath)
  const roomMoments = storedMoments
    .filter((moment) => moment.roomId === roomId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8)
  const momentIds = new Set(roomMoments.map((moment) => moment.id))
  const critiques = storedCritics
    .filter((critique) => momentIds.has(critique.parentMomentId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12)
    .map((critique): SkillMomentCritique => ({ ...critique }))
  const critiquesByMoment = new Map<string, SkillMomentCritique[]>()

  for (const critique of critiques) {
    const entries = critiquesByMoment.get(critique.parentMomentId) ?? []
    entries.push(critique)
    critiquesByMoment.set(critique.parentMomentId, entries)
  }

  return {
    moments: roomMoments.map((moment): SkillMoment => ({
      ...moment,
      critiques: (critiquesByMoment.get(moment.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    })),
    critiques,
  }
}

function skillMomentSilencePolicy(roomId: string): string {
  if (roomId === WRITER_ROOM_ID) {
    return [
      'Publish only if you can advance the current screenplay artifact, expose a continuity gap, sharpen character conflict, or add a concrete rewrite action.',
      'If the skill would only restate room history, summarize generic taste, or react without changing the artifact, output exactly <SILENCE/>.',
    ].join(' ')
  }

  return [
    'Publish only if you can add a new persona action, visible conflict, public move, counterattack, or decision-relevant claim.',
    'Source digests are off-screen triggers, not feed copy. If the contribution only says "I read this source" or summarizes a digest, output exactly <SILENCE/>.',
  ].join(' ')
}

function shouldUseRealSkillMoments(
  requestedMode: ReturnType<typeof resolveSkillMomentExecutionMode>,
  result?: SkillMomentRealExecutionResult,
): result is SkillMomentRealExecutionResult {
  return requestedMode === 'real' && !!result?.available
}

async function listSkillMoments(args: SkillMomentListInput): Promise<{ moments: SkillMoment[] }> {
  const workspace = getWorkspaceByNameOrId(args.workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${args.workspaceId}`)
  }

  return await listSkillMomentsForWorkspace(workspace.rootPath, {
    roomId: args.roomId,
    limit: args.limit,
  })
}

async function runSkillMomentCycle(
  args: SkillMomentRunCycleInput,
  emitStatus?: SkillMomentRunStatusEmitter,
): Promise<SkillMomentRunCycleResult> {
  const workspace = getWorkspaceByNameOrId(args.workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${args.workspaceId}`)
  }

  const roomId = args.roomId?.trim() || 'debate'
  const lockKey = `${args.workspaceId}:${roomId}`
  if (skillMomentCycleLocks.has(lockKey)) {
    throw new Error(`Skill Moments cycle already running for ${roomId}`)
  }

  skillMomentCycleLocks.add(lockKey)
  try {
    const runId = args.runId || `moment-run-${Date.now()}-${randomUUID().slice(0, 8)}`
    const status = (
      phase: SkillMomentRunStatusEvent['phase'],
      message: string,
      detail?: string,
    ) => emitStatus?.({
      workspaceId: args.workspaceId,
      roomId,
      runId,
      phase,
      message,
      detail,
      createdAt: new Date().toISOString(),
    })
    const createdAt = new Date().toISOString()
    const momentsDir = skillMomentsWorkspaceDir(workspace.rootPath)
    const sourceDigestsPath = join(momentsDir, 'source-digests.jsonl')
    const momentsPath = join(momentsDir, 'moments.jsonl')
    const criticsPath = join(momentsDir, 'critics.jsonl')
    const runsPath = join(momentsDir, 'runs.jsonl')
    const actorStatesPath = join(momentsDir, 'actor-states.jsonl')
    const actorMemoryPath = join(momentsDir, 'actor-memory.jsonl')
    const sourceDigests = mockSkillMomentSourceDigests(runId, createdAt)
    const requestedMode = resolveSkillMomentExecutionMode(args.mode)
    const browserUse = resolveAgentOSBrowserUseCapability()
    const roomPolicy = getSkillCrewRoomPolicy(roomId)
    const isWriterRoom = roomId === WRITER_ROOM_ID
    const debateScenePack = roomId === 'debate' ? getHomelanderFallenGodScenePack() : undefined
    status('planning', '准备 Skill Moments 房间', `room=${roomId}，mode=${requestedMode}`)
    let eligibleSkills = roomPolicy.orderParticipants(
      (await resolveSkillMomentParticipants(args, workspace.rootPath, roomId))
        .filter((skill) => roomPolicy.shouldAutoInclude(skill)),
    )
    if (isWriterRoom && eligibleSkills.length === 0) {
      eligibleSkills = roomPolicy.orderParticipants(defaultSkillMomentParticipants())
    }
    const maxMoments = isWriterRoom
      ? Math.min(Math.max(args.maxMoments ?? WRITER_ROOM_MOCK_PHASES.length, 1), WRITER_ROOM_MOCK_PHASES.length)
      : Math.min(Math.max(
        args.maxMoments ?? (debateScenePack
          ? seededInt(
            `${runId}:scene-pack-moment-count`,
            debateScenePack.globalDirectives.randomization.momentCountRange.min,
            debateScenePack.globalDirectives.randomization.momentCountRange.max,
          )
          : 3),
        1,
      ), 6)
    const maxCriticsPerMoment = isWriterRoom
      ? Math.min(Math.max(args.maxCriticsPerMoment ?? 3, 0), 3)
      : Math.min(Math.max(args.maxCriticsPerMoment ?? 5, 0), 5)
    const momentPlans = buildDefaultSkillMomentPlans(roomId, eligibleSkills, maxMoments, runId)
    status(
      'planning',
      '已规划本轮出场顺序',
      momentPlans.map((plan) => plan.author.name || plan.author.handle).join('、'),
    )
    const writerRoomPhase: WriterRoomPhase | undefined = isWriterRoom
      ? momentPlans[momentPlans.length - 1]?.artifactKind ?? 'continuity_report'
      : undefined
    const moments: SkillMoment[] = []
    const mediaErrors: string[] = []
    const recentHistory = requestedMode === 'real'
      ? await readRecentSkillMomentHistory(momentsPath, criticsPath, roomId)
      : { moments: [], critiques: [] }

    for (const digest of sourceDigests) {
      await appendJsonlRecord(sourceDigestsPath, digest)
    }

    let realExecutionResult: SkillMomentRealExecutionResult | undefined
    let realInstructions: SkillMomentInstruction[] = []
    let realWorkingDirectory = workspace.rootPath
    let actorMemoryRecords: SkillActorMemoryRecord[] = []
    let actorMemoryRecordCount = 0
    let actorCritiqueDecisionCount = 0
    let actorCritiqueStateUpdateCount = 0
    if (requestedMode === 'real') {
      status('writing', '调用真实 skill 执行', '每个 skill 会读取自己的 SKILL.md 并决定发言或沉默。')
      realInstructions = await loadSkillMomentInstructions(workspace.rootPath, args.workingDirectory)
      realWorkingDirectory = args.workingDirectory && existsSync(args.workingDirectory)
        ? args.workingDirectory
        : workspace.rootPath
      actorMemoryRecords = await readJsonlRecords<SkillActorMemoryRecord>(actorMemoryPath)

      realExecutionResult = await executeRealSkillMomentPlans({
        plans: momentPlans,
        instructions: realInstructions,
        roomId,
        sourceDigests,
        actorMemoryRecords,
        recentMoments: recentHistory.moments,
        recentCritiques: recentHistory.critiques,
        silencePolicy: skillMomentSilencePolicy(roomId),
        browserUse,
        executor: async (execArgs) => runCodexSkillExec({
          prompt: execArgs.prompt,
          workingDirectory: execArgs.workingDirectory,
          timeoutMs: execArgs.timeoutMs,
          reasoningEffort: execArgs.reasoningEffort,
        }),
        workingDirectory: realWorkingDirectory,
        timeoutMs: 180_000,
      })

      if (!realExecutionResult.available) {
        mainLog.warn('Skill Moments real mode unavailable; falling back to mock cycle:', realExecutionResult.errors.join('; '))
      }
      for (const decision of realExecutionResult.decisions) {
        await appendJsonlRecord(actorStatesPath, {
          schemaVersion: 1,
          runId,
          workspaceId: args.workspaceId,
          roomId,
          planIndex: decision.planIndex,
          skillId: decision.author.id,
          skillName: decision.author.name,
          handle: decision.author.handle,
          decision: decision.decision,
          reason: decision.reason,
          body: decision.body,
          mediaPrompt: decision.mediaPrompt,
          stateUpdates: decision.stateUpdates ?? [],
          createdAt,
        })
        const memoryRecords = buildSkillActorMemoryRecords({
          decision,
          workspaceId: args.workspaceId,
          roomId,
          runId,
          createdAt,
        })
        for (const memoryRecord of memoryRecords) {
          await appendJsonlRecord(actorMemoryPath, memoryRecord)
          actorMemoryRecords.push(memoryRecord)
          actorMemoryRecordCount += 1
        }
      }
    }

    const realExecution = shouldUseRealSkillMoments(requestedMode, realExecutionResult)
      ? realExecutionResult
      : undefined
    const useRealMoments = !!realExecution
    const plannedOutputs: Array<{
      planIndex: number
      author: SkillMomentSkillInput
      artifactKind?: WriterArtifactKind
      body: string
      mode: 'mock' | 'real'
      decision?: string
      reason?: string
      mediaPrompt?: string
      artifacts?: string[]
      sceneBeat?: HomelanderFallenGodBeat
    }> = useRealMoments
      ? realExecution.publications.map((publication: SkillMomentRealPublication) => ({
        planIndex: publication.planIndex,
        author: publication.author,
        artifactKind: publication.artifactKind,
        body: publication.body,
        mode: 'real',
        decision: publication.decision,
        reason: publication.reason,
        mediaPrompt: publication.mediaPrompt,
      }))
      : momentPlans.map((plan, index) => {
        const digest = sourceDigests[index % sourceDigests.length]!
        const publication = buildMockMomentPublication(plan.author, digest, index, roomId, plan.artifactKind, runId)
        return {
          planIndex: index,
          author: plan.author,
          artifactKind: plan.artifactKind,
          body: publication.body,
          mode: 'mock',
          mediaPrompt: publication.mediaPrompt,
          artifacts: publication.artifacts,
          sceneBeat: publication.sceneBeat,
        }
      })

    status('writing', '生成朋友圈正文和评论', `${plannedOutputs.length} 条主贴，评论数量会按角色关系变化。`)
    for (const [outputIndex, output] of plannedOutputs.entries()) {
      const { author, artifactKind, body, planIndex } = output
      const digest = sourceDigests[planIndex % sourceDigests.length]!
      const momentId = `${runId}-moment-${outputIndex + 1}`
      if (!roomPolicy.shouldKeepMoment(author, body)) {
        continue
      }
      const orderedCritics = roomPolicy.orderCritics(
        author,
        eligibleSkills.filter((skill) => skill.id !== author.id),
        { artifactKind },
      )
      const selectedCritics = isWriterRoom
        ? orderedCritics.slice(0, maxCriticsPerMoment)
        : output.sceneBeat && normalizeSkillMomentSlug(author) === 'homelander'
          ? selectHomelanderFallenGodCriticSlugs({
            availableSlugs: orderedCritics.map((critic) => normalizeSkillMomentSlug(critic)),
            beat: output.sceneBeat,
            seed: `${runId}:${momentId}:scene-pack-critics`,
            maxCritics: maxCriticsPerMoment,
          })
            .map((slug) => maybeGetSkillBySlug(orderedCritics, slug))
            .filter((skill): skill is SkillMomentSkillInput => Boolean(skill))
          : selectDebateCriticsForMoment(
            author,
            eligibleSkills.filter((skill) => skill.id !== author.id),
            orderedCritics,
            maxCriticsPerMoment,
            `${runId}:${momentId}`,
          )
      let critics: SkillMomentCritique[] = []
      if (useRealMoments) {
        const critiqueExecution = await executeRealSkillMomentCritiquePlans({
          plans: selectedCritics.map((critic, criticIndex) => ({
            parentMomentId: momentId,
            parentAuthor: author,
            parentBody: body,
            critic,
            criticIndex,
            artifactKind,
          })),
          instructions: realInstructions,
          roomId,
          sourceDigests,
          actorMemoryRecords,
          recentMoments: [
            {
              id: momentId,
              roomId,
              skillId: author.id,
              skillName: author.name,
              handle: author.handle,
              body,
              confidence: 'medium',
              createdAt,
              sources: [],
              critiques: [],
              artifacts: output.decision ? [`actor_decision:${output.decision}`] : undefined,
            },
            ...recentHistory.moments,
          ],
          recentCritiques: [
            ...recentHistory.critiques,
            ...moments.flatMap((moment) => moment.critiques),
          ],
          silencePolicy: skillMomentSilencePolicy(roomId),
          browserUse,
          executor: async (execArgs) => runCodexSkillExec({
            prompt: execArgs.prompt,
            workingDirectory: execArgs.workingDirectory,
            timeoutMs: execArgs.timeoutMs,
            reasoningEffort: execArgs.reasoningEffort,
          }),
          workingDirectory: realWorkingDirectory,
          timeoutMs: 120_000,
        })
        for (const decision of critiqueExecution.decisions) {
          actorCritiqueDecisionCount += 1
          actorCritiqueStateUpdateCount += decision.stateUpdates?.length ?? 0
          await appendJsonlRecord(actorStatesPath, {
            schemaVersion: 1,
            runId,
            workspaceId: args.workspaceId,
            roomId,
            planIndex: decision.planIndex,
            target: decision.target,
            skillId: decision.author.id,
            skillName: decision.author.name,
            handle: decision.author.handle,
            decision: decision.decision,
            reason: decision.reason,
            body: decision.body,
            mediaPrompt: decision.mediaPrompt,
            stateUpdates: decision.stateUpdates ?? [],
            createdAt,
          })
          const memoryRecords = buildSkillActorMemoryRecords({
            decision,
            workspaceId: args.workspaceId,
            roomId,
            runId,
            createdAt,
          })
          for (const memoryRecord of memoryRecords) {
            await appendJsonlRecord(actorMemoryPath, memoryRecord)
            actorMemoryRecords.push(memoryRecord)
            actorMemoryRecordCount += 1
          }
        }
        critics = critiqueExecution.publications
          .flatMap((publication: SkillMomentRealCritiquePublication, critiqueIndex): SkillMomentCritique[] => {
            if (!roomPolicy.shouldKeepCritique(author, publication.critic, publication.body)) {
              return []
            }

            return [{
              id: `${momentId}-critic-${critiqueIndex + 1}`,
              parentMomentId: momentId,
              criticSkillId: publication.critic.id,
              criticSkillName: publication.critic.name,
              criticHandle: publication.critic.handle,
              body: publication.body,
              createdAt,
              reactions: roomId === 'debate'
                ? buildMockCritiqueReactions(
                  author,
                  publication.critic,
                  eligibleSkills,
                  `${runId}:${momentId}:real-critic-${critiqueIndex + 1}`,
                  createdAt,
                )
                : undefined,
              artifacts: [
                artifactKind ? 'writer_room_real_critic' : 'agentos_real_critic',
                artifactKind ? writerArtifactTag(artifactKind) : undefined,
                `actor_decision:${publication.decision}`,
              ].filter((artifact): artifact is string => Boolean(artifact)),
            }]
          })
      } else {
        critics = selectedCritics
          .flatMap((critic, criticIndex): SkillMomentCritique[] => {
            const critiqueBody = buildMockCritiqueBody(
              author,
              critic,
              planIndex + criticIndex,
              roomId,
              artifactKind,
              output.sceneBeat,
              runId,
            )
            if (!roomPolicy.shouldKeepCritique(author, critic, critiqueBody)) {
              return []
            }

            return [{
              id: `${momentId}-critic-${criticIndex + 1}`,
              parentMomentId: momentId,
              criticSkillId: critic.id,
              criticSkillName: critic.name,
              criticHandle: critic.handle,
              body: critiqueBody,
              createdAt,
              reactions: roomId === 'debate'
                ? buildMockCritiqueReactions(
                  author,
                  critic,
                  eligibleSkills,
                  `${runId}:${momentId}:critic-${criticIndex + 1}`,
                  createdAt,
                )
                : undefined,
              artifacts: artifactKind
                ? ['writer_room_mock_critic', writerArtifactTag(artifactKind), 'critic_limit_20_chars']
                : compactUniqueArtifacts([
                  'agentos_mock_critic',
                  output.sceneBeat ? 'scene_pack:homelander-fallen-god' : undefined,
                  output.sceneBeat ? `beat:${output.sceneBeat.id}` : undefined,
                  output.sceneBeat ? 'scene_pack_comment' : 'variable_length_reply',
                ]),
            }]
          })
      }
      const counterReply = buildHomelanderCounterReply(
        author,
        selectedCritics,
        momentId,
        planIndex,
        createdAt,
        eligibleSkills,
      )
      if (!useRealMoments && counterReply && roomPolicy.shouldKeepCritique(author, author, counterReply.body)) {
        critics = [...critics, counterReply]
      }
      const mediaResult = output.mediaPrompt
        ? await maybeGenerateSkillActorRequestedMedia({
          author,
          body,
          mediaPrompt: output.mediaPrompt,
          roomId,
          momentId,
          momentsDir,
          createdAt,
          browserUse,
          emitStatus,
          workspaceId: args.workspaceId,
          runId,
        })
        : await maybeGenerateHomelanderMomentMedia({
          author,
          body,
          roomId,
          momentId,
          momentsDir,
          createdAt,
          browserUse,
          emitStatus,
          workspaceId: args.workspaceId,
          runId,
        })
      if (mediaResult.source) {
        await appendJsonlRecord(sourceDigestsPath, mediaResult.source)
      }
      if (mediaResult.error) {
        mediaErrors.push(`${momentId}: ${mediaResult.error}`)
      }

      const attachSourceDigest = shouldAttachSkillMomentSource(author, roomId)
      const sources = [
        ...(attachSourceDigest ? [digest] : []),
        ...(mediaResult.source ? [mediaResult.source] : []),
      ]
      const moment: SkillMoment = {
        id: momentId,
        roomId,
        skillId: author.id,
        skillName: author.name,
        handle: author.handle,
        body,
        confidence: 'medium',
        createdAt,
        sources,
        critiques: critics,
        reactions: roomId === 'debate'
          ? buildMockMomentReactions(author, eligibleSkills, `${runId}:${momentId}`, createdAt)
          : undefined,
        media: mediaResult.media.length > 0 ? mediaResult.media : undefined,
        artifacts: output.mode === 'real'
          ? [
            ...realSkillMomentArtifacts(artifactKind),
            output.decision ? `actor_decision:${output.decision}` : undefined,
            output.mediaPrompt ? 'actor_media_request' : undefined,
            mediaResult.media.length > 0 ? 'agentos_browser_media' : undefined,
          ].filter((artifact): artifact is string => Boolean(artifact))
          : (artifactKind
            ? ['writer_room_mock_moment', writerArtifactTag(artifactKind)]
            : compactUniqueArtifacts([
              'agentos_mock_moment',
              ...(output.artifacts ?? [attachSourceDigest ? 'source_digest_mock' : 'persona_scene_moment']),
              output.sceneBeat ? 'homelander_fallen_god_scene_pack' : undefined,
              body.includes('仅') ? 'private_visibility_mock' : undefined,
              mediaResult.media.length > 0 ? 'agentos_browser_media' : undefined,
            ])),
      }

      const storedMoment: StoredSkillMoment = {
        id: moment.id,
        roomId: moment.roomId,
        skillId: moment.skillId,
        skillName: moment.skillName,
        handle: moment.handle,
        body: moment.body,
        confidence: moment.confidence,
        createdAt: moment.createdAt,
        sources: moment.sources,
        reactions: moment.reactions,
        media: moment.media,
        artifacts: moment.artifacts,
      }
      await appendJsonlRecord(momentsPath, storedMoment)
      for (const critique of critics) {
        await appendJsonlRecord(criticsPath, critique)
      }
      moments.push(moment)
    }

    status('persisting', '写入 Skill Moments JSONL', `${moments.length} 条主贴，${moments.reduce((count, moment) => count + moment.critiques.length, 0)} 条评论。`)
    await appendJsonlRecord(runsPath, {
      schemaVersion: 1,
      runId,
      workspaceId: args.workspaceId,
      roomId,
      startedAt: createdAt,
      endedAt: new Date().toISOString(),
      mode: useRealMoments ? 'manual_llm' : 'manual_mock',
      requestedExecutionMode: requestedMode,
      fallbackExecutionMode: requestedMode === 'real' && !useRealMoments ? 'mock' : undefined,
      realEvaluatedSkillCount: realExecutionResult?.evaluatedCount ?? 0,
      realExecutionErrorCount: realExecutionResult?.errors.length ?? 0,
      actorDecisionCount: realExecutionResult?.decisions.length ?? 0,
      actorStateUpdateCount: realExecutionResult?.decisions.reduce((count, decision) => count + (decision.stateUpdates?.length ?? 0), 0) ?? 0,
      actorCritiqueDecisionCount,
      actorCritiqueStateUpdateCount,
      actorMemoryRecordCount,
      browserUse: {
        enabled: browserUse.enabled,
        provider: browserUse.provider,
        browserName: browserUse.browserName,
        executablePath: browserUse.executablePath,
        profileDir: browserUse.profileDir,
        remoteDebuggingPort: browserUse.remoteDebuggingPort,
        policy: browserUse.policy,
        reason: browserUse.reason,
      },
      sourceDigestCount: sourceDigests.length,
      ...(writerRoomPhase ? {
        phase: writerRoomPhase,
        artifactCount: moments.length,
      } : {}),
      momentCount: moments.length,
      criticCount: moments.reduce((count, moment) => count + moment.critiques.length, 0),
      mediaCount: moments.reduce((count, moment) => count + (moment.media?.length ?? 0), 0),
      mediaErrorCount: mediaErrors.length,
      mediaErrors: mediaErrors.length > 0 ? mediaErrors.slice(0, 5) : undefined,
      status: 'success',
    })
    status('complete', '本轮朋友圈已完成', `生成 ${moments.length} 条主贴。`)

    return {
      success: true,
      runId,
      moments,
      sourceDigests,
      path: momentsDir,
    }
  } finally {
    skillMomentCycleLocks.delete(lockKey)
  }
}

async function recordSkillMomentFeedback(args: SkillMomentFeedbackRecordInput): Promise<{ success: boolean; path: string }> {
  const workspace = getWorkspaceByNameOrId(args.workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${args.workspaceId}`)
  }

  return await recordSkillMomentFeedbackForWorkspace(workspace.rootPath, args)
}

function normalizeCrewFolderPath(folderPath: string): string {
  return folderPath
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== '.' && part !== '..')
    .join('/')
}

function assertPathInside(rootDir: string, targetPath: string): void {
  const root = resolve(rootDir)
  const target = resolve(targetPath)
  const rel = relative(root, target)
  if (target !== root && (rel.startsWith('..') || rel === '..' || rel.startsWith('/'))) {
    throw new Error(`Path escapes target directory: ${targetPath}`)
  }
}

async function importSkillToCrewFolder(args: SkillCrewImportSkillArgs): Promise<SkillCrewImportSkillResult> {
  const workspace = getWorkspaceByNameOrId(args.workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${args.workspaceId}`)
  }

  const slug = args.slug.trim()
  if (!slug || slug.includes('/') || slug.includes('\\') || slug === '.' || slug === '..') {
    throw new Error(`Invalid skill slug: ${args.slug}`)
  }

  const sourceDir = resolve(args.sourceSkillPath)
  const sourceSkillFile = join(sourceDir, 'SKILL.md')
  if (!existsSync(sourceSkillFile)) {
    throw new Error(`Source SKILL.md not found: ${sourceSkillFile}`)
  }

  const skillsRoot = join(workspace.rootPath, 'skills')
  const targetFolderPath = normalizeCrewFolderPath(args.targetFolderPath)
  const targetParent = targetFolderPath ? join(skillsRoot, targetFolderPath) : skillsRoot
  const targetDir = join(targetParent, slug)

  assertPathInside(skillsRoot, targetParent)
  assertPathInside(skillsRoot, targetDir)

  if (resolve(sourceDir) === resolve(targetDir)) {
    const { loadSkillBySlug } = await import('@craft-agent/shared/skills')
    const existing = loadSkillBySlug(workspace.rootPath, slug, args.workingDirectory)
    if (!existing) {
      throw new Error(`Skill could not be reloaded: ${slug}`)
    }
    return { skill: existing, targetPath: targetDir }
  }

  if (existsSync(targetDir)) {
    throw new Error(`Target skill already exists: ${targetDir}`)
  }

  await mkdir(targetParent, { recursive: true })
  await cp(sourceDir, targetDir, { recursive: true })

  const { invalidateSkillsCache, loadSkillBySlug } = await import('@craft-agent/shared/skills')
  invalidateSkillsCache()

  const effectiveWorkingDir = args.workingDirectory && existsSync(args.workingDirectory)
    ? args.workingDirectory
    : undefined
  const imported = loadSkillBySlug(workspace.rootPath, slug, effectiveWorkingDir)
  if (!imported) {
    throw new Error(`Imported skill could not be reloaded: ${slug}`)
  }

  return { skill: imported, targetPath: targetDir }
}

// Set app name early (before app.whenReady) to ensure correct macOS menu bar title
// Supports multi-instance dev: CRAFT_APP_NAME env var (e.g., "debt [1]")
app.setName(process.env.CRAFT_APP_NAME || 'debt')

// Register as default protocol client for craftagents:// URLs
// This must be done before app.whenReady() on some platforms
if (process.defaultApp) {
  // Development mode: need to pass the app path
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEPLINK_SCHEME, process.execPath, [process.argv[1]])
  }
} else {
  // Production mode
  app.setAsDefaultProtocolClient(DEEPLINK_SCHEME)
}

// Apply network proxy settings early (Node-level only — Electron sessions require app.whenReady)
import { applyConfiguredProxySettings } from './network-proxy'
void applyConfiguredProxySettings()

// Accept self-signed / untrusted certificates when connecting to a user-configured remote server.
// Only bypasses cert validation for the exact CRAFT_SERVER_URL origin — all other connections
// use standard certificate verification. Without this, wss:// to self-signed servers fails with
// ERR_CERT_AUTHORITY_INVALID because Chromium's WebSocket rejects untrusted certs.
//
// Electron's certificate-error always reports URLs with https:// scheme, so we normalize
// wss:// → https:// (and ws:// → http://) to ensure origins compare correctly.
function normalizeOriginForCert(urlStr: string): string {
  const u = new URL(urlStr)
  if (u.protocol === 'wss:') u.protocol = 'https:'
  else if (u.protocol === 'ws:') u.protocol = 'http:'
  return u.origin
}

if (process.env.CRAFT_SERVER_URL) {
  let serverOrigin: string | undefined
  try {
    serverOrigin = normalizeOriginForCert(process.env.CRAFT_SERVER_URL)
  } catch {
    // Invalid URL — will fail later during connection, no need to handle here
  }
  if (serverOrigin) {
    app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
      try {
        if (normalizeOriginForCert(url) === serverOrigin) {
          event.preventDefault()
          callback(true)
          return
        }
      } catch {
        // URL parse failure — fall through to default rejection
      }
      callback(false)
    })
  }
}

// Register thumbnail:// custom protocol for file preview thumbnails in the sidebar.
// Must happen before app.whenReady() — Electron requires early scheme registration.
registerThumbnailScheme()

// Handle deeplink on macOS (when app is already running)
app.on('open-url', (event, url) => {
  event.preventDefault()
  mainLog.info('Received deeplink:', url)

  if (windowManager) {
    handleDeepLink(url, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined).catch(err => {
      mainLog.error('Failed to handle deep link:', err)
    })
  } else {
    // App not ready - store for later
    pendingDeepLink = url
  }
})

// Handle deeplink on Windows/Linux (single instance check)
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    // On Windows/Linux, the deeplink is in commandLine
    const url = commandLine.find(arg => arg.startsWith(`${DEEPLINK_SCHEME}://`))
    if (url && windowManager) {
      mainLog.info('Received deeplink from second instance:', url)
      handleDeepLink(url, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined).catch(err => {
        mainLog.error('Failed to handle deep link:', err)
      })
    } else if (windowManager) {
      // No deep link - just focus the first window
      const windows = windowManager.getAllWindows()
      if (windows.length > 0) {
        const win = windows[0].window
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    }
  })
}

// Helper to create initial windows on startup
async function createInitialWindows(): Promise<void> {
  if (!windowManager) return

  // Load saved window state
  const savedState = loadWindowState()
  let workspaces = getWorkspaces()

  // If no workspaces exist, create default "My Workspace" on first run
  if (workspaces.length === 0) {
    // Ensure config file exists (addWorkspace requires it)
    if (!loadStoredConfig()) {
      saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })
    }
    const defaultPath = join(getDefaultWorkspacesDir(), 'my-workspace')
    addWorkspace({ rootPath: defaultPath, name: 'My Workspace' })
    workspaces = getWorkspaces() // Refresh after creation
    mainLog.info('Created default workspace on first run')
  }

  const validWorkspaceIds = workspaces.map(ws => ws.id)

  if (savedState?.windows.length) {
    // Restore windows from saved state
    let restoredCount = 0

    for (const saved of savedState.windows) {
      // Skip invalid workspaces
      if (!validWorkspaceIds.includes(saved.workspaceId)) continue

      // Restore main window with focused mode if it was saved
      mainLog.info(`Restoring window: workspaceId=${saved.workspaceId}, focused=${saved.focused ?? false}, url=${saved.url ?? 'none'}`)
      const win = windowManager.createWindow({
        workspaceId: saved.workspaceId,
        focused: saved.focused,
        restoreUrl: saved.url,
      })
      win.setBounds(saved.bounds)

      restoredCount++
    }

    if (restoredCount > 0) {
      mainLog.info(`Restored ${restoredCount} window(s) from saved state`)
      return
    }
  }

  // Default: open window for first workspace
  windowManager.createWindow({ workspaceId: workspaces[0].id })
  mainLog.info(`Created window for first workspace: ${workspaces[0].name}`)
}

app.whenReady().then(async () => {
  // Export packaged state as env var so logger.ts (and headless Bun) don't need 'electron'
  process.env.CRAFT_IS_PACKAGED = app.isPackaged ? 'true' : 'false'

  // Register bundled assets root so all seeding functions can find their files
  // (docs, permissions, themes, tool-icons resolve via getBundledAssetsDir)
  setBundledAssetsRoot(__dirname)

  // Initialize backend runtime bootstrapping (Codex vendor root, Claude SDK runtime paths).
  initializeBackendHostRuntime({
    hostRuntime: {
      appRootPath: resolveElectronAppRoot(app),
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged,
    },
  })

  // Register PowerShell validator root so it can find the bundled parser script
  // (Windows only: validates PowerShell commands in Explore mode using AST analysis)
  setPowerShellValidatorRoot(join(__dirname, 'resources'))

  // Initialize bundled docs
  initializeDocs()

  // Initialize bundled release notes
  initializeReleaseNotes()

  // Ensure default permissions file exists (copies bundled default.json on first run)
  ensureDefaultPermissions()

  // Seed tool icons to ~/.craft-agent/tool-icons/ (copies bundled SVGs on first run)
  ensureToolIcons()

  // Seed preset themes to ~/.craft-agent/themes/ (copies bundled theme JSONs on first run)
  ensurePresetThemes()

  // Register thumbnail:// protocol handler (scheme was registered earlier, before app.whenReady)
  registerThumbnailHandler()

  // Re-apply proxy settings now that Electron sessions are available
  // (first call before app.whenReady only configured Node-level proxy)
  await applyConfiguredProxySettings()

  // Note: electron-updater handles pending updates internally via autoInstallOnAppQuit

  // Application menu is created after windowManager initialization (see below)

  // Set dock icon on macOS (required for dev mode, bundled apps use Info.plist)
  if (process.platform === 'darwin' && app.dock) {
    // In packaged app, resources are at dist/resources/ (same level as __dirname)
    // In dev, resources are at ../resources/ (sibling of dist/)
    const dockIconPath = [
      join(__dirname, 'resources/icon.png'),
      join(__dirname, '../resources/icon.png'),
    ].find(p => existsSync(p))

    if (dockIconPath) {
      app.dock.setIcon(dockIconPath)
      // Initialize badge icon for canvas-based badge overlay
      initBadgeIcon(dockIconPath)
    }

    // Multi-instance dev: show instance number badge on dock icon
    // CRAFT_INSTANCE_NUMBER is set by detect-instance.sh for numbered folders
    const instanceNum = process.env.CRAFT_INSTANCE_NUMBER
    if (instanceNum) {
      const num = parseInt(instanceNum, 10)
      if (!isNaN(num) && num > 0) {
        initInstanceBadge(num)
      }
    }
  }

  try {
    // Initialize window manager
    windowManager = new WindowManager()

    // Create the application menu (needs windowManager for New Window action)
    createApplicationMenu(windowManager)

    // When CRAFT_SERVER_URL is set, this Electron instance is a thin client —
    // it only creates windows whose preload connects to the remote server.
    // Skip server-side initialization (SessionManager, model refresh, platform injection).
    const isClientOnly = !!process.env.CRAFT_SERVER_URL
    const isHeadless = !!process.env.CRAFT_HEADLESS

    if (isClientOnly) {
      mainLog.info(`Client-only mode: CRAFT_SERVER_URL=${process.env.CRAFT_SERVER_URL} (server initialization skipped)`)
    }

    // Initialize notification service (always — triggered by server push events)
    initNotificationService(windowManager)
    initFlowNotifications(windowManager)

    // Initialize browser pane manager (always — even in headless, for deps wiring)
    browserPaneManager = new BrowserPaneManager()
    browserPaneManager.setWindowManager(windowManager)
    browserPaneManager.registerToolbarIpc()

    // Build real PlatformServices from Electron APIs
    const platform: PlatformServices = createElectronPlatform({
      app,
      nativeImage,
      shell,
      nativeTheme,
      logger: log,
      isDebugMode,
      getLogFilePath,
      captureError: (err) => Sentry.captureException(err),
    })

    // Bootstrap IPC handlers — preload uses sendSync for window-local details
    ipcMain.on('__get-web-contents-id', (e) => {
      e.returnValue = e.sender.id
    })
    ipcMain.on('__get-workspace-id', (e) => {
      e.returnValue = windowManager?.getWorkspaceForWindow(e.sender.id) ?? ''
    })

    // Transport diagnostics bridge — preload reports remote WS connection state changes
    // so failures are visible in terminal/main.log (not only renderer console).
    ipcMain.on('__transport:status', (_event, payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const p = payload as {
        level?: 'info' | 'warn' | 'error'
        message?: string
        status?: string
        attempt?: number
        nextRetryInMs?: number
        error?: unknown
        close?: unknown
        url?: string
      }

      const level = p.level ?? 'info'
      const message = p.message ?? '[transport] status update'
      const context = {
        status: p.status,
        attempt: p.attempt,
        nextRetryInMs: p.nextRetryInMs,
        error: p.error,
        close: p.close,
        url: p.url,
      }

      if (level === 'error') {
        mainLog.error(message, context)
      } else if (level === 'warn') {
        mainLog.warn(message, context)
      } else {
        mainLog.info(message, context)
      }
    })

    // Dialog bridge — preload capability handlers use ipcRenderer.invoke to
    // call main-process-only dialog APIs (dialog, BrowserWindow).
    ipcMain.handle('__dialog:showMessageBox', async (event, spec) => {
      const win = BrowserWindow.fromWebContents(event.sender)
        || BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showMessageBox(win, spec)
      return { response: result.response }
    })
    ipcMain.handle('__dialog:showOpenDialog', async (event, spec) => {
      const win = BrowserWindow.fromWebContents(event.sender)
        || BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showOpenDialog(win, spec)
      return { canceled: result.canceled, filePaths: result.filePaths }
    })

    if (!isClientOnly) {
      // Restore persisted Git Bash path on Windows (must happen before any SDK subprocess spawn)
      if (process.platform === 'win32') {
        const { getGitBashPath, clearGitBashPath } = await import('@craft-agent/shared/config')
        const gitBashPath = getGitBashPath()
        if (gitBashPath) {
          const validation = await validateGitBashPath(gitBashPath)
          if (validation.valid) {
            process.env.CLAUDE_CODE_GIT_BASH_PATH = validation.path
          } else {
            clearGitBashPath()
            delete process.env.CLAUDE_CODE_GIT_BASH_PATH
            mainLog.warn(`Cleared invalid persisted Git Bash path: ${gitBashPath}`)
          }
        }
      }

      // Check for VC++ Redistributable on Windows (required by onnxruntime / markitdown).
      // Without it, document conversion tools (PDF, PPTX, DOCX, XLSX) crash with DLL errors.
      // Sets env var so renderer can show an actionable toast with install button.
      if (process.platform === 'win32') {
        const vcCheck = checkVCRedistInstalled()
        if (!vcCheck.installed) {
          mainLog.warn('[vcredist]', vcCheck.message)
          process.env.CRAFT_VCREDIST_MISSING = '1'
          if (vcCheck.downloadUrl) {
            process.env.CRAFT_VCREDIST_URL = vcCheck.downloadUrl
          }
        } else if (isDebugMode) {
          mainLog.info('[vcredist]', vcCheck.message)
        }
      }

      // Pre-import power manager (async import needed for applyPlatformToSubsystems)
      const { onSessionStarted, onSessionStopped } = await import('./power-manager')

      // Client ID tracking for Electron IPC bridge (webContentsId → clientId)
      const clientMap = new Map<number, string>()
      const resolveClientId = (wcId: number) => clientMap.get(wcId)

      // Read embedded server config (Server settings page)
      const { getServerConfig } = await import('@craft-agent/shared/config')
      const embeddedServerConfig = getServerConfig()
      const serverModeEnabled = embeddedServerConfig.enabled && !isClientOnly

      // Derive host/port/token from server config (or env overrides)
      const serverToken = serverModeEnabled && embeddedServerConfig.token
        ? embeddedServerConfig.token
        : randomUUID()
      const rpcHost = process.env.CRAFT_RPC_HOST
        ?? (serverModeEnabled ? '0.0.0.0' : '127.0.0.1')
      const rpcPort = process.env.CRAFT_RPC_PORT
        ? parseInt(process.env.CRAFT_RPC_PORT, 10)
        : (serverModeEnabled ? embeddedServerConfig.port : 0)

      // Load TLS certificates if configured
      let tls: import('@craft-agent/server-core/transport').WsRpcTlsOptions | undefined
      if (serverModeEnabled && embeddedServerConfig.tlsCertPath && embeddedServerConfig.tlsKeyPath) {
        try {
          tls = {
            cert: readFileSync(embeddedServerConfig.tlsCertPath),
            key: readFileSync(embeddedServerConfig.tlsKeyPath),
          }
          mainLog.info('[server-mode] TLS enabled')
        } catch (err) {
          mainLog.error('[server-mode] Failed to load TLS certificates:', err)
        }
      }

      if (serverModeEnabled) {
        mainLog.info(`[server-mode] Enabled — binding ${rpcHost}:${rpcPort}${tls ? ' (TLS)' : ''}`)
      }

      // Bootstrap the WS RPC server via shared bootstrap function.
      const instance = await bootstrapServer<SessionManager, HandlerDeps>({
        serverToken,
        rpcHost,
        rpcPort,
        tls,
        bundledAssetsRoot: __dirname,
        serverId: 'local',
        serverVersion: app.getVersion(),
        platformFactory: () => platform,
        applyPlatformToSubsystems: (p) => {
          setFetcherPlatform(p)
          setSessionPlatform(p)
          setSessionRuntimeHooks({
            updateBadgeCount,
            onSessionStarted,
            onSessionStopped,
            captureException: (error, context) => {
              Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
                tags: {
                  ...(context?.errorSource ? { errorSource: context.errorSource } : {}),
                  ...(context?.sessionId ? { sessionId: context.sessionId } : {}),
                },
              })
            },
          })
          setSearchPlatform(p)
          setImageProcessor(p.imageProcessor)
        },
        createSessionManager: () => {
          const sm = new SessionManager()
          sm.setBrowserPaneManager(browserPaneManager!)
          return sm
        },
        createHandlerDeps: ({ sessionManager: sm, platform: p, oauthFlowStore: ofs }) => {
          // The messaging handle is built here because it needs sessionManager.
          // The WS publisher is attached after bootstrapServer resolves (via
          // handle.setPublisher) because wsServer isn't available yet.
          messagingHandle = createMessagingBootstrap({
            sessionManager: sm,
            credentialManager: getCredentialManager(),
            getMessagingDir: (wsId: string) =>
              join(homedir(), '.craft-agent', 'workspaces', wsId, 'messaging'),
            getLegacyMessagingDir: (wsId: string) => {
              const ws = getWorkspaces().find((w) => w.id === wsId)
              return ws ? join(ws.rootPath, 'messaging') : undefined
            },
            // Route messaging diagnostics through the dedicated messaging log
            // at ~/.craft-agent/logs/messaging-gateway.log.
            logger: messagingGatewayLog,
            // WhatsApp worker runs under Electron's embedded Node via
            // ELECTRON_RUN_AS_NODE (WhatsAppAdapter defaults nodeBin to
            // process.execPath). In dev we resolve worker.cjs from the
            // monorepo; in packaged builds it's shipped via extraResources
            // (see apps/electron/electron-builder.yml).
            whatsapp: {
              workerEntry: app.isPackaged
                ? join(process.resourcesPath, 'messaging-whatsapp-worker', 'worker.cjs')
                : join(process.cwd(), 'packages', 'messaging-whatsapp-worker', 'dist', 'worker.cjs'),
              pairingMode: 'qr',
            },
          })
          return {
            sessionManager: sm,
            platform: p,
            windowManager: windowManager ?? undefined,
            browserPaneManager: browserPaneManager ?? undefined,
            oauthFlowStore: ofs,
            messagingRegistry: messagingHandle.registry,
            skillMomentRunCycleExecutor: (input, emitStatus) => runSkillMomentCycle(input, emitStatus),
          }
        },
        // Headless: register only core handlers (no GUI handlers for browser, settings, etc.)
        // GUI: register all handlers (core + GUI)
        registerAllRpcHandlers: isHeadless
          ? (server, deps, serverCtx) => registerCoreRpcHandlers(server, deps, serverCtx)
          : registerAllRpcHandlers,
        setSessionEventSink: (sm, sink) => sm.setEventSink(sink),
        initializeSessionManager: (sm) => sm.initialize(),
        initModelRefreshService: () => initModelRefreshService(async (slug: string) => {
          const { getCredentialManager } = await import('@craft-agent/shared/credentials')
          const manager = getCredentialManager()
          const [apiKey, oauth] = await Promise.all([
            manager.getLlmApiKey(slug).catch(() => null),
            manager.getLlmOAuth(slug).catch(() => null),
          ])
          return {
            apiKey: apiKey ?? undefined,
            oauthAccessToken: oauth?.accessToken,
            oauthRefreshToken: oauth?.refreshToken,
            oauthIdToken: oauth?.idToken,
          }
        }),
        onClientConnected: ({ clientId, webContentsId }) => {
          if (webContentsId != null) clientMap.set(webContentsId, clientId)
        },
        cleanupClientResources: (clientId) => {
          for (const [wcId, cId] of clientMap) {
            if (cId === clientId) { clientMap.delete(wcId); break }
          }
          cleanupSessionFileWatchForClient(clientId)
        },
      })

      // Capture module-level references for before-quit cleanup and deep-link handlers
      sessionManager = instance.sessionManager
      oauthFlowStore = instance.oauthFlowStore
      moduleSink = instance.wsServer.push.bind(instance.wsServer)
      moduleClientResolver = resolveClientId

      // -----------------------------------------------------------------------
      // Messaging Gateway — attach the WS publisher, init local workspaces,
      // install the fan-out event sink. The handle was created inside
      // createHandlerDeps so the registry could be wired into HandlerDeps.
      // -----------------------------------------------------------------------
      try {
        if (!messagingHandle) {
          throw new Error('Messaging handle was not constructed in createHandlerDeps')
        }

        messagingHandle.setPublisher(instance.wsServer.push.bind(instance.wsServer))

        // Skip remote-owned workspaces — messaging runs on the remote server.
        const localWorkspaceIds = getWorkspaces()
          .filter((ws) => !ws.remoteServer)
          .map((ws) => ws.id)
        await messagingHandle.initializeWorkspaces(localWorkspaceIds)

        // Compose fan-out event sink: RPC push + messaging gateway dispatch.
        // Always install — this lets workspaces enable messaging at runtime
        // without a process restart.
        const baseSink = instance.wsServer.push.bind(instance.wsServer)
        instance.sessionManager.setEventSink(messagingHandle.wrapSink(baseSink))
        if (messagingHandle.registry.size > 0) {
          mainLog.info(`[messaging] Fan-out sink active for ${messagingHandle.registry.size} workspace(s)`)
        }
      } catch (err) {
        mainLog.error('[messaging] Gateway initialization failed:', err)
      }

      // IPC handlers — preload uses sendSync to get WS connection details

      // Remove workspace from config (cleanup stale entries)
      ipcMain.handle('workspace:remove', async (_event, workspaceId: string) => {
        const { removeWorkspace: remove } = await import('@craft-agent/shared/config')
        return remove(workspaceId)
      })

      // Cross-server RPC — invoke a channel on an arbitrary remote server
      ipcMain.handle('server:invokeOnServer', async (_event, url: string, token: string, channel: string, ...args: unknown[]) => {
        const { connectToRemote } = await import('./handlers/workspace')
        const { client, error } = await connectToRemote(url, token)
        if (!client) throw new Error(error ?? 'Connection failed')
        try {
          return await client.invoke(channel, ...args)
        } finally {
          client.destroy()
        }
      })

      // Transfer session to another workspace — orchestrated in main process
      // so large bundles can be moved directly between owning servers.
      ipcMain.handle('session:transferToRemoteWorkspace', async (_event, sessionId: string, targetWorkspaceId: string, sessionIndex?: number, sessionCount?: number) => {
        const idx = sessionIndex ?? 0
        const count = sessionCount ?? 1
        const { getWorkspaceByNameOrId } = await import('@craft-agent/shared/config')
        const { connectToRemote } = await import('./handlers/workspace')
        const { CHUNKED_TRANSFER_THRESHOLD, getChunkCount, invokeChunked, prepareChunkedPayload } = await import('./chunked-rpc')

        const targetWorkspace = getWorkspaceByNameOrId(targetWorkspaceId)
        if (!targetWorkspace?.remoteServer) throw new Error(`Workspace ${targetWorkspaceId} has no remote server`)
        if (!sessionManager) throw new Error('Session manager not initialized')

        const sourceWorkspaceLocalId = windowManager?.getWorkspaceForWindow(_event.sender.id)
        if (!sourceWorkspaceLocalId) throw new Error('Unable to resolve source workspace for transfer')

        const sourceWorkspace = getWorkspaceByNameOrId(sourceWorkspaceLocalId)
        if (!sourceWorkspace) throw new Error(`Source workspace ${sourceWorkspaceLocalId} not found`)

        let bundle: any = null

        if (sourceWorkspace.remoteServer) {
          const { url: sourceUrl, token: sourceToken, remoteWorkspaceId: sourceRemoteWorkspaceId } = sourceWorkspace.remoteServer
          console.log(`[Transfer] Exporting remote-owned session ${sessionId} from workspace ${sourceRemoteWorkspaceId}...`)
          const { client: sourceClient, error: sourceError } = await connectToRemote(sourceUrl, sourceToken, sourceRemoteWorkspaceId)
          if (!sourceClient) throw new Error(sourceError ?? 'Connection failed to source remote server')

          try {
            bundle = await sourceClient.invoke('sessions:export', sessionId)
            if (!bundle) throw new Error(`Failed to export session ${sessionId}`)

            try {
              console.log('[Transfer] Generating conversation summary on source server...')
              const transferPayload = await sourceClient.invoke('sessions:exportRemoteTransfer', sessionId)
              if (transferPayload?.summary && bundle.session?.header) {
                ;(bundle.session.header as any).transferredSessionSummary = transferPayload.summary
                ;(bundle.session.header as any).transferredSessionSummaryApplied = false
                console.log(`[Transfer] Summary generated: ${transferPayload.summary.length} chars`)
              }
            } catch (err) {
              console.warn('[Transfer] Source-server summary generation failed:', err)
            }
          } finally {
            sourceClient.destroy()
          }
        } else {
          console.log(`[Transfer] Exporting local-owned session ${sessionId} from workspace ${sourceWorkspace.id}...`)
          bundle = await sessionManager.exportSession(sessionId, sourceWorkspace.id)
          if (!bundle) throw new Error(`Failed to export session ${sessionId}`)

          try {
            console.log('[Transfer] Generating conversation summary...')
            const transferPayload = await sessionManager.exportRemoteSessionTransfer(sessionId, sourceWorkspace.id)
            if (transferPayload?.summary && bundle.session?.header) {
              ;(bundle.session.header as any).transferredSessionSummary = transferPayload.summary
              ;(bundle.session.header as any).transferredSessionSummaryApplied = false
              console.log(`[Transfer] Summary generated: ${transferPayload.summary.length} chars`)
            }
          } catch (err) {
            console.warn('[Transfer] Summary generation failed:', err)
          }
        }

        console.log(`[Transfer] Export complete: ${bundle.session?.messages?.length ?? 0} messages, ${bundle.files?.length ?? 0} files`)

        const { url, token, remoteWorkspaceId } = targetWorkspace.remoteServer
        console.log(`[Transfer] Connecting to target remote server: ${url}`)
        const { client, error } = await connectToRemote(url, token, remoteWorkspaceId)
        if (!client) throw new Error(error ?? 'Connection failed to target remote server')
        console.log('[Transfer] Connected to target remote server')

        try {
          const preparedBundle = prepareChunkedPayload(bundle)
          const payloadSize = preparedBundle.bytes.length
          const payloadMB = (payloadSize / (1024 * 1024)).toFixed(1)

          const emitProgress = (chunkSent: number, chunkTotal: number) => {
            try { _event.sender.send('transfer:progress', { sessionIndex: idx, sessionCount: count, chunkSent, chunkTotal }) } catch { /* renderer may be gone */ }
          }

          if (payloadSize < CHUNKED_TRANSFER_THRESHOLD) {
            console.log(`[Transfer] Bundle size: ${payloadMB}MB (< 5MB threshold) → using direct RPC`)
            emitProgress(0, 1)
            const result = await client.invoke('sessions:import', remoteWorkspaceId, bundle, 'fork')
            emitProgress(1, 1)
            return result
          }

          const chunkCount = getChunkCount(payloadSize)
          console.log(`[Transfer] Bundle size: ${payloadMB}MB (>= 5MB threshold) → using chunked transfer (${chunkCount} chunks)`)
          return await invokeChunked(
            client,
            'sessions:import',
            [remoteWorkspaceId, bundle, 'fork'],
            1,
            emitProgress,
            preparedBundle,
          )
        } finally {
          client.destroy()
        }
      })

      // App relaunch (for server config changes — NOT an update install)
      ipcMain.handle('app:relaunch', () => {
        app.relaunch()
        app.exit(0)
      })

      // Language change: sync from renderer to main process and rebuild native menu
      ipcMain.handle('i18n:changeLanguage', async (_event, lang: string) => {
        i18n.changeLanguage(lang)
        const { rebuildMenu } = await import('./menu')
        await rebuildMenu()
      })

      // Flow-next task planning bridge. These handlers are intentionally local:
      // they operate on the user's filesystem and stream status directly to the
      // renderer window that initiated the request.
      ipcMain.handle('git:getRoot', async (_event, dirPath: string) => {
        return await execGit(dirPath, ['rev-parse', '--show-toplevel'])
      })

      ipcMain.handle('git:getInfo', async (_event, dirPath: string) => {
        return await getGitInfo(dirPath)
      })

      ipcMain.handle('skill-crew:run-codex-skill', async (_event, args: {
        prompt: string
        workingDirectory?: string
        model?: string
        timeoutMs?: number
        reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
      }) => {
        return await runCodexSkillExec(args)
      })

      ipcMain.handle('skill-crew:record-feedback', async (_event, args: SkillFeedbackRecordInput) => {
        return await recordSkillFeedbackSample(args)
      })

      ipcMain.handle('skill-moments:list', async (_event, args: SkillMomentListInput) => {
        return await listSkillMoments(args)
      })

      ipcMain.handle('skill-moments:record-feedback', async (_event, args: SkillMomentFeedbackRecordInput) => {
        return await recordSkillMomentFeedback(args)
      })

      ipcMain.handle('skill-crew:refresh-skills', async (_event, workspaceId: string, workingDirectory?: string) => {
        const workspace = getWorkspaceByNameOrId(workspaceId)
        if (!workspace) {
          throw new Error(`Workspace not found: ${workspaceId}`)
        }
        const effectiveWorkingDir = workingDirectory && existsSync(workingDirectory)
          ? workingDirectory
          : undefined
        const { invalidateSkillsCache, loadAllSkills } = await import('@craft-agent/shared/skills')
        invalidateSkillsCache()
        return loadAllSkills(workspace.rootPath, effectiveWorkingDir)
      })

      ipcMain.handle('skill-crew:import-skill', async (_event, args: SkillCrewImportSkillArgs) => {
        return await importSkillToCrewFolder(args)
      })

      ipcMain.handle('flow:project:check-status', async (_event, workspaceRoot: string) => {
        if (!workspaceRoot || !existsSync(workspaceRoot)) {
          return { status: 'error', error: 'Project path does not exist' }
        }
        return {
          status: existsSync(join(workspaceRoot, '.flow')) ? 'initialized' : 'needs-setup',
        }
      })

      ipcMain.handle('flow:project:register', async (_event, workspaceRoot: string) => {
        if (!workspaceRoot || !existsSync(workspaceRoot)) {
          return { success: false, error: 'Project path does not exist' }
        }
        startFlowWatcher(workspaceRoot)
        return { success: true }
      })

      ipcMain.handle('flow:project:unregister', async (_event, workspaceRoot: string) => {
        stopFlowWatcher(workspaceRoot)
        return { success: true }
      })

      ipcMain.handle('flow:project:read-context', async (_event, workspaceRoot: string) => {
        return readFlowProjectContext(workspaceRoot)
      })

      ipcMain.handle('flow:init', async (_event, workspaceRoot: string) => {
        const result = await getFlowBridge(workspaceRoot).init()
        if (result.ok) startFlowWatcher(workspaceRoot)
        return result
      })

      ipcMain.handle('flow:epics:list', async (_event, workspaceRoot: string) => {
        return await getFlowBridge(workspaceRoot).listEpics()
      })

      ipcMain.handle('flow:tasks:list', async (_event, workspaceRoot: string, epicId: string) => {
        return await getFlowBridge(workspaceRoot).listTasks(epicId)
      })

      ipcMain.handle('flow:task:show', async (_event, workspaceRoot: string, taskId: string) => {
        return await getFlowBridge(workspaceRoot).showTask(taskId)
      })

      ipcMain.handle('flow:task:update-status', async (_event, workspaceRoot: string, taskId: string, status: TaskStatus) => {
        return await getFlowBridge(workspaceRoot).updateTaskStatus(taskId, status)
      })

      ipcMain.handle('flow:epic:create', async (_event, workspaceRoot: string, title: string, branch?: string) => {
        return await getFlowBridge(workspaceRoot).createEpic(title, branch)
      })

      ipcMain.handle('flow:epic:set-plan', async (_event, workspaceRoot: string, epicId: string, content: string) => {
        return await getFlowBridge(workspaceRoot).setEpicPlan(epicId, content)
      })

      ipcMain.handle('flow:epic:delete', async (_event, workspaceRoot: string, epicId: string) => {
        return await getFlowBridge(workspaceRoot).deleteEpic(epicId)
      })

      ipcMain.handle('flow:ui-state:read', async (_event, workspaceRoot: string) => {
        return await getFlowBridge(workspaceRoot).readUiState()
      })

      ipcMain.handle('flow:ui-state:write', async (_event, workspaceRoot: string, state: FlowUiState) => {
        return await getFlowBridge(workspaceRoot).writeUiState(state)
      })

      ipcMain.handle('flow:epic:plan', async (event, workspaceRoot: string, epicId: string) => {
        const win = getSenderWindow(event)
        if (!win) return { ok: false, error: 'No window available for planning status' }
        try {
          const result = await executePlan(workspaceRoot, epicId, win, getFlowBridge(workspaceRoot))
          pendingFlowPlans.set(getPendingPlanKey(workspaceRoot, epicId), result)
          return { ok: true, data: result }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'Failed to generate plan' }
        }
      })

      ipcMain.handle('flow:epic:plan-approve', async (event, workspaceRoot: string, epicId: string) => {
        const win = getSenderWindow(event)
        if (!win) return { ok: false, error: 'No window available for planning status' }
        const key = getPendingPlanKey(workspaceRoot, epicId)
        const pendingPlan = pendingFlowPlans.get(key)
        if (!pendingPlan) {
          return { ok: false, error: 'No pending plan to approve. Run /plan first.' }
        }
        try {
          await applyPlan(workspaceRoot, epicId, pendingPlan.tasks, getFlowBridge(workspaceRoot), win)
          pendingFlowPlans.delete(key)
          return { ok: true, data: { success: true } }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'Failed to approve plan' }
        }
      })

      ipcMain.handle(
        'flow:epic-chat:send',
        async (
          event,
          workspaceRoot: string,
          epicId: string,
          commandType: FlowChatCommandType,
          message: string,
          history: FlowChatMessage[],
          registeredProjects?: RegisteredProject[],
        ) => {
          const win = getSenderWindow(event)
          if (!win) return { success: false, error: 'No window available for chat status' }
          await executeChat({
            workspaceRoot,
            epicId,
            commandType,
            message,
            history,
            window: win,
            registeredProjects,
          })
          return { success: true }
        },
      )

      ipcMain.handle('flow:epic-chat:abort', async (_event, workspaceRoot: string, epicId: string) => {
        return abortChat(workspaceRoot, epicId)
      })

      ipcMain.handle('flow:notification:show', async (_event, payload) => {
        return showFlowNotification(payload)
      })

      ipcMain.on('__get-ws-port', (e) => {
        e.returnValue = instance.port
      })
      ipcMain.on('__get-ws-token', (e) => {
        e.returnValue = instance.token
      })
      ipcMain.on('__get-workspace-remote-config', (e) => {
        const wsId = windowManager?.getWorkspaceForWindow(e.sender.id)
        if (!wsId) { e.returnValue = null; return }
        const ws = getWorkspaceByNameOrId(wsId)
        e.returnValue = ws?.remoteServer ?? null
      })

      // Server config RPC handlers (LOCAL_ONLY — Electron-specific)
      const runningServerState = {
        host: rpcHost,
        port: instance.port,
        tls: !!tls,
        token: serverToken,
        enabled: serverModeEnabled,
      }

      instance.wsServer.handle(RPC_CHANNELS.settings.GET_SERVER_CONFIG, async () => {
        const { getServerConfig: getConfig } = await import('@craft-agent/shared/config')
        return getConfig()
      })

      instance.wsServer.handle(RPC_CHANNELS.settings.SET_SERVER_CONFIG, async (_ctx: unknown, config: unknown) => {
        const { setServerConfig: setConfig } = await import('@craft-agent/shared/config')
        const cfg = config as import('@craft-agent/shared/config/server-config').ServerConfig
        // Validate port range
        if (cfg.port < 1024 || cfg.port > 65535) {
          throw new Error(`Port must be between 1024 and 65535, got ${cfg.port}`)
        }
        // Validate cert/key files exist if provided
        if (cfg.tlsCertPath && !existsSync(cfg.tlsCertPath)) {
          throw new Error(`Certificate file not found: ${cfg.tlsCertPath}`)
        }
        if (cfg.tlsKeyPath && !existsSync(cfg.tlsKeyPath)) {
          throw new Error(`Private key file not found: ${cfg.tlsKeyPath}`)
        }
        setConfig(cfg)
      })

      instance.wsServer.handle(RPC_CHANNELS.settings.GET_SERVER_STATUS, async () => {
        const { getServerConfig: getConfig } = await import('@craft-agent/shared/config')
        const saved = getConfig()
        const protocol = runningServerState.tls ? 'wss' : 'ws'

        // Determine display host (LAN IP if bound to 0.0.0.0)
        let displayHost = runningServerState.host
        if (displayHost === '0.0.0.0' || displayHost === '::') {
          const os = await import('os')
          const nets = os.networkInterfaces()
          for (const name of Object.keys(nets)) {
            for (const net of nets[name] ?? []) {
              if (net.family === 'IPv4' && !net.internal) {
                displayHost = net.address
                break
              }
            }
            if (displayHost !== '0.0.0.0' && displayHost !== '::') break
          }
        }

        // Only compare port/tls/token when at least one side has server mode enabled.
        // When both are disabled, the running port is random — comparing it to the
        // saved default (9100) would always produce a false "restart required" banner.
        const needsRestart = saved.enabled !== runningServerState.enabled
          || ((saved.enabled || runningServerState.enabled) && (
            saved.port !== runningServerState.port
            || (!!saved.tlsCertPath) !== runningServerState.tls
            || (saved.token ?? '') !== runningServerState.token
          ))

        return {
          running: true,
          host: runningServerState.host,
          port: runningServerState.port,
          tls: runningServerState.tls,
          url: `${protocol}://${displayHost}:${runningServerState.port}`,
          token: runningServerState.token,
          needsRestart,
          insecureWarning: isInsecureBind,
        }
      })

      // TLS enforcement — warn when server mode binds to a network address without TLS
      // Mirrors the hard guard in packages/server/src/index.ts but warns instead of blocking,
      // since the user explicitly enabled server mode via UI (may be on a trusted LAN).
      const isInsecureBind = serverModeEnabled && !tls
        && !['127.0.0.1', 'localhost', '::1'].includes(rpcHost)
      if (isInsecureBind) {
        mainLog.warn(
          '[server-mode] WARNING: Listening on a network address without TLS. ' +
          'Auth tokens will be sent in cleartext. ' +
          'Configure TLS certificates in Settings > Server.'
        )
      }

      // Wire EventSink to Electron-specific services
      // Must happen BEFORE createInitialWindows() so event handlers use WS from the start
      windowManager.setRpcEventSink(moduleSink!, resolveClientId)
      const { setMenuEventSink } = await import('./menu')
      setMenuEventSink(moduleSink!, resolveClientId)
      const { setNotificationEventSink } = await import('./notifications')
      setNotificationEventSink(moduleSink!, resolveClientId)

      // Headless: print connection details
      if (isHeadless) {
        console.log(`CRAFT_SERVER_URL=${instance.protocol}://${instance.host}:${instance.port}`)
        console.log(`CRAFT_SERVER_TOKEN=${instance.token}`)
      }
    }

    // Create initial windows (restores from saved state or opens first workspace)
    // In headless mode the server runs without any UI — skip window creation.
    if (!isHeadless) {
      await createInitialWindows()
    }

    // Run credential health check at startup to detect issues early
    // (corruption, machine migration, missing credentials for default connection)
    // Skip in thin-client mode — credentials are managed by the remote server.
    if (!isClientOnly) {
      try {
        const { getCredentialManager } = await import('@craft-agent/shared/credentials')
        const credentialManager = getCredentialManager()
        const health = await credentialManager.checkHealth()
        if (!health.healthy) {
          mainLog.warn('Credential health check failed:', health.issues)
          // Issues will be displayed in Settings → AI when user navigates there
        }
      } catch (err) {
        mainLog.error('Credential health check error:', err)
      }
    }

    // Initialize power manager (loads setting, must happen after config is available)
    // Non-critical — powerSaveBlocker may not work on headless/xvfb setups
    try {
      const { initPowerManager } = await import('./power-manager')
      await initPowerManager()
    } catch (err) {
      mainLog.warn('[power] Power manager init failed (non-critical):', err instanceof Error ? err.message : err)
    }

    // Set Sentry context tags for error grouping (no PII — just config classification).
    // Runs after init so config and auth state are available.
    // Derives values from the default LLM connection instead of legacy config fields.
    try {
      const { getLlmConnection, getDefaultLlmConnection } = await import('@craft-agent/shared/config')
      const workspaces = getWorkspaces()
      const defaultConnSlug = getDefaultLlmConnection()
      const defaultConn = defaultConnSlug ? getLlmConnection(defaultConnSlug) : null
      Sentry.setTag('authType', defaultConn?.authType ?? 'unknown')
      Sentry.setTag('providerType', defaultConn?.providerType ?? 'unknown')
      Sentry.setTag('hasCustomEndpoint', String(!!defaultConn?.baseUrl))
      Sentry.setTag('model', defaultConn?.defaultModel ?? 'default')
      Sentry.setTag('workspaceCount', String(workspaces.length))
    } catch (err) {
      mainLog.warn('Failed to set Sentry context tags:', err)
    }

    // Initialize auto-update (check immediately on launch)
    // Skip in dev mode to avoid replacing /Applications app and launching it instead
    if (moduleSink) setAutoUpdateEventSink(moduleSink)
    if (app.isPackaged) {
      checkForUpdatesOnLaunch().catch(err => {
        mainLog.error('[auto-update] Launch check failed:', err)
      })
    } else {
      mainLog.info('[auto-update] Skipping auto-update in dev mode')
    }

    // Process pending deep link from cold start
    if (pendingDeepLink) {
      mainLog.info('Processing pending deep link:', pendingDeepLink)
      await handleDeepLink(pendingDeepLink, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined)
      pendingDeepLink = null
    }

    mainLog.info('App initialized successfully')
    if (isDebugMode) {
      mainLog.info('Debug mode enabled - logs at:', getLogFilePath())
    }
    mainLog.info('Messaging gateway log path:', getMessagingGatewayLogFilePath())
  } catch (error) {
    mainLog.error('Failed to initialize app:', error instanceof Error ? error.message : error, (error as any)?.stack)
    // Continue anyway - the app will show errors in the UI
  }

  // macOS: Re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && windowManager) {
      // Open first workspace or last focused
      const workspaces = getWorkspaces()
      if (workspaces.length > 0) {
        const savedState = loadWindowState()
        const wsId = savedState?.lastFocusedWorkspaceId || workspaces[0].id
        // Verify workspace still exists
        if (workspaces.some(ws => ws.id === wsId)) {
          windowManager.createWindow({ workspaceId: wsId })
        } else {
          windowManager.createWindow({ workspaceId: workspaces[0].id })
        }
      }
    }
  })
})

app.on('window-all-closed', () => {
  if (process.env.CRAFT_HEADLESS) return  // headless server stays alive
  // On macOS, apps typically stay active until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Track if we're in the process of quitting (to avoid re-entry)
let isQuitting = false

// Save window state and clean up resources before quitting
app.on('before-quit', async (event) => {
  // Avoid re-entry when we call app.exit()
  if (isQuitting) return
  isQuitting = true

  // Ensure Cmd+Q/app quit bypasses layered window close interception (Cmd+W behavior).
  windowManager?.setAppQuitting(true)

  if (windowManager) {
    // Get full window states (includes bounds, type, and query)
    const windows = windowManager.getWindowStates()
    // Get the focused window's workspace as last focused
    const focusedWindow = BrowserWindow.getFocusedWindow()
    let lastFocusedWorkspaceId: string | undefined
    if (focusedWindow) {
      lastFocusedWorkspaceId = windowManager.getWorkspaceForWindow(focusedWindow.webContents.id) ?? undefined
    }

    saveWindowState({
      windows,
      lastFocusedWorkspaceId,
    })
    mainLog.info('Saved window state:', windows.length, 'windows')
  }

  // Flush all pending session writes before quitting
  if (sessionManager) {
    // Prevent quit until sessions are flushed
    event.preventDefault()
    try {
      await sessionManager.flushAllSessions()
      mainLog.info('Flushed all pending session writes')
    } catch (error) {
      mainLog.error('Failed to flush sessions:', error)
    }
    // Clean up SessionManager resources (file watchers, timers, etc.)
    sessionManager.cleanup()

    // Clean up browser pane instances
    if (browserPaneManager) {
      browserPaneManager.destroyAll()
    }

    // Clean up OAuth flow store (stop periodic cleanup timer)
    if (oauthFlowStore) {
      oauthFlowStore.dispose()
    }

    // Stop all model refresh timers
    getModelRefreshService().stopAll()

    // Stop messaging gateways so the WhatsApp worker subprocess exits cleanly.
    if (messagingHandle) {
      try {
        await messagingHandle.dispose()
      } catch (err) {
        mainLog.error('[messaging] dispose failed:', err)
      }
    }

    // Clean up power manager (release power blocker)
    const { cleanup: cleanupPowerManager } = await import('./power-manager')
    cleanupPowerManager()

    // Release the server lock file so the next launch doesn't see a stale PID.
    // This must happen regardless of the exit path (normal quit or update quit).
    releaseServerLock()

    // If update is in progress, let electron-updater handle the quit flow
    // Force exit breaks the NSIS installer on Windows
    if (isUpdating()) {
      mainLog.info('Update in progress, letting electron-updater handle quit')
      app.quit()
      return
    }

    // Now actually quit
    app.exit(0)
  }
})

// Handle uncaught exceptions — forward to Sentry explicitly since registering
// a custom handler can interfere with @sentry/electron's automatic capture.
process.on('uncaughtException', (error) => {
  mainLog.error('Uncaught exception:', error)
  Sentry.captureException(error)
})

process.on('unhandledRejection', (reason, promise) => {
  mainLog.error('Unhandled rejection at:', promise, 'reason:', reason)
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)))
})
