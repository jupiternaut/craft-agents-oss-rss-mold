import { execFile } from 'child_process'
import { existsSync, unlinkSync, readdirSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { FlowUiState } from '../../shared/types'
import {
  CommandSuccessSchema,
  EpicListResponseSchema,
  EpicSchema,
  EpicCreateResponseSchema,
  EpicSetPlanResponseSchema,
  TaskListResponseSchema,
  TaskSchema,
  type CommandSuccess,
  type EpicListResponse,
  type Epic,
  type EpicCreateResponse,
  type EpicSetPlanResponse,
  type TaskListResponse,
  type Task,
  type TaskStatus,
  type FlowBridgeError,
  type FlowBridgeResult,
} from '../../shared/flow-schemas'
import type { ZodSchema, ZodError } from 'zod'

const TIMEOUT_MS = 10_000

/**
 * FlowBridge: execFile wrapper for flowctl with --json output.
 *
 * - Resolves flowctl binary per workspace (.flow/bin/flowctl first, then PATH)
 * - 10s timeout on all commands
 * - Serialized write queue (max 1 concurrent write) to prevent file lock contention
 *   when user drags cards rapidly in the Kanban board
 * - Parses + validates output with Zod schemas
 */
export class FlowBridge {
  private workspaceRoot: string
  private flowctlPath: string | null = null
  private writeQueue: Promise<unknown> = Promise.resolve()

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot
  }

  /** Resolve flowctl binary: .flow/bin/flowctl first, then global PATH */
  private resolveFlowctl(): string {
    if (this.flowctlPath) return this.flowctlPath

    const localPath = join(this.workspaceRoot, '.flow', 'bin', 'flowctl')
    if (existsSync(localPath)) {
      this.flowctlPath = localPath
      return localPath
    }

    // Fall back to PATH — will fail at exec time with ENOENT if not found
    this.flowctlPath = 'flowctl'
    return 'flowctl'
  }

  /** Execute a read-only flowctl command (no serialization) */
  private exec<T>(args: string[], schema: ZodSchema<T>): Promise<FlowBridgeResult<T>> {
    return this.runCommand(args, schema)
  }

  /** Execute a write flowctl command (serialized, max 1 concurrent to prevent file lock contention) */
  private execWrite<T>(args: string[], schema: ZodSchema<T>): Promise<FlowBridgeResult<T>> {
    const promise = this.writeQueue.then(() => this.runCommand(args, schema))
    // Log errors but don't propagate — keep the queue moving for subsequent writes
    this.writeQueue = promise.catch((err) => {
      console.error('[FlowBridge] Write operation failed:', err)
    })
    return promise
  }

  private runCommand<T>(args: string[], schema: ZodSchema<T>): Promise<FlowBridgeResult<T>> {
    return new Promise((resolve) => {
      const flowctl = this.resolveFlowctl()
      const fullArgs = [...args, '--json']

      execFile(
        flowctl,
        fullArgs,
        {
          cwd: this.workspaceRoot,
          timeout: TIMEOUT_MS,
          maxBuffer: 1024 * 1024, // 1MB
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          if (error) {
            // Check if it's a timeout
            if (error.killed || (error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
              return resolve({
                ok: false,
                error: { type: 'timeout', command: `flowctl ${args.join(' ')}` },
              })
            }
            // Check if flowctl not found
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              this.flowctlPath = null // Reset cache so next call re-resolves
              return resolve({ ok: false, error: { type: 'flowctl_not_found' } })
            }
            // Command failed
            return resolve({
              ok: false,
              error: {
                type: 'command_failed',
                stderr: stderr || error.message,
                exitCode: error.code ? Number(error.code) : 1,
              },
            })
          }

          // Parse JSON
          let parsed: unknown
          try {
            parsed = JSON.parse(stdout)
          } catch {
            return resolve({
              ok: false,
              error: {
                type: 'invalid_json',
                stdout: stdout.slice(0, 500), // Truncate for safety
              },
            })
          }

          // Validate with Zod
          const result = schema.safeParse(parsed)
          if (!result.success) {
            return resolve({
              ok: false,
              error: { type: 'invalid_output', zodError: result.error as ZodError },
            })
          }

          resolve({ ok: true, data: result.data })
        },
      )
    })
  }

  // ─── Public API ─────────────────────────────────────────────────────

  /** List all epics */
  listEpics(): Promise<FlowBridgeResult<EpicListResponse>> {
    return this.exec(['epics'], EpicListResponseSchema)
  }

  /** List tasks for an epic */
  listTasks(epicId: string): Promise<FlowBridgeResult<TaskListResponse>> {
    return this.exec(['tasks', '--epic', epicId], TaskListResponseSchema)
  }

  /** Show epic details */
  showEpic(epicId: string): Promise<FlowBridgeResult<Epic>> {
    return this.exec(['show', epicId], EpicSchema)
  }

  /** Show task details */
  showTask(taskId: string): Promise<FlowBridgeResult<Task>> {
    return this.exec(['show', taskId], TaskSchema)
  }

  /** Start a task (claim it). Only status transition supported by flowctl directly. */
  startTask(taskId: string): Promise<FlowBridgeResult<CommandSuccess>> {
    return this.execWrite(['start', taskId], CommandSuccessSchema)
  }

  /**
   * Update task status.
   * Maps to flowctl commands:
   * - todo: `flowctl task reset <taskId>`
   * - in_progress: `flowctl start <taskId>`
   * - blocked: Not directly supported (needs reason file) - returns error
   * - done: `flowctl done <taskId> --summary "Status changed via GUI" --force`
   */
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<FlowBridgeResult<CommandSuccess>> {
    switch (status) {
      case 'todo':
        return this.execWrite(['task', 'reset', taskId], CommandSuccessSchema)
      case 'in_progress':
        return this.execWrite(['start', taskId], CommandSuccessSchema)
      case 'done':
        // Use --force to skip evidence checks (commits/tests) since GUI status changes
        // don't include evidence. Dependency validation still runs via flowctl internally.
        // --summary is required by flowctl.
        return this.execWrite(['done', taskId, '--summary', 'Status changed via GUI', '--force'], CommandSuccessSchema)
      case 'blocked':
        // Blocking requires a reason file - not supported via simple drag-drop
        return Promise.resolve({
          ok: false,
          error: {
            type: 'command_failed',
            stderr: 'Blocking a task requires a reason. Use the task detail panel instead.',
            exitCode: 1,
          },
        })
      default:
        return Promise.resolve({
          ok: false,
          error: {
            type: 'command_failed',
            stderr: `Unknown status: ${status}`,
            exitCode: 1,
          },
        })
    }
  }

  /** Initialize flow-next in workspace */
  init(): Promise<FlowBridgeResult<CommandSuccess>> {
    return this.execWrite(['init'], CommandSuccessSchema)
  }

  /** Create a new epic */
  createEpic(title: string, branch?: string): Promise<FlowBridgeResult<EpicCreateResponse>> {
    const args = ['epic', 'create', '--title', title]
    if (branch) {
      args.push('--branch', branch)
    }
    return this.execWrite(args, EpicCreateResponseSchema)
  }

  /**
   * Set epic plan/spec content.
   * Uses stdin to pass content (--file -)
   */
  setEpicPlan(epicId: string, content: string): Promise<FlowBridgeResult<EpicSetPlanResponse>> {
    return this.execWriteWithStdin(
      ['epic', 'set-plan', epicId, '--file', '-'],
      content,
      EpicSetPlanResponseSchema
    )
  }

  // ─── UI State Persistence ───────────────────────────────────────────

  /**
   * Read per-project UI state from .flow/ui-state.json.
   * Returns null if file doesn't exist or is invalid JSON.
   */
  async readUiState(): Promise<FlowUiState | null> {
    try {
      const statePath = join(this.workspaceRoot, '.flow', 'ui-state.json')
      if (!existsSync(statePath)) return null
      const content = await readFile(statePath, 'utf-8')
      return JSON.parse(content) as FlowUiState
    } catch {
      return null
    }
  }

  /**
   * Write per-project UI state to .flow/ui-state.json.
   * Serialized through the write queue to prevent file lock contention.
   * Also ensures ui-state.json is in .flow/.gitignore.
   */
  writeUiState(state: FlowUiState): Promise<{ success: boolean; error?: string }> {
    const writeOperation = async (): Promise<{ success: boolean; error?: string }> => {
      try {
        const flowDir = join(this.workspaceRoot, '.flow')
        if (!existsSync(flowDir)) {
          return { success: false, error: '.flow/ directory does not exist' }
        }
        const statePath = join(flowDir, 'ui-state.json')
        await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8')
        // Ensure ui-state.json is in .flow/.gitignore
        await this.ensureGitignoreEntry(flowDir, 'ui-state.json')
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    }

    const promise = this.writeQueue.then(writeOperation)
    this.writeQueue = promise.catch((err) => {
      console.error('[FlowBridge] UI state write failed:', err)
    })
    return promise
  }

  /**
   * Ensure a line exists in .flow/.gitignore.
   * Creates the file if it doesn't exist.
   */
  private async ensureGitignoreEntry(flowDir: string, entry: string): Promise<void> {
    const gitignorePath = join(flowDir, '.gitignore')
    try {
      if (existsSync(gitignorePath)) {
        const content = await readFile(gitignorePath, 'utf-8')
        const lines = content.split('\n').map(l => l.trim())
        if (lines.includes(entry)) return
        // Append entry
        const separator = content.endsWith('\n') ? '' : '\n'
        await writeFile(gitignorePath, content + separator + entry + '\n', 'utf-8')
      } else {
        await writeFile(gitignorePath, entry + '\n', 'utf-8')
      }
    } catch (err) {
      // Best-effort — don't fail the write operation, but warn about gitignore issue
      console.warn(`[FlowBridge] Failed to update .flow/.gitignore: ${err instanceof Error ? err.message : err}`)
    }
  }

  /** Delete an epic and its tasks by removing files directly */
  deleteEpic(epicId: string): Promise<FlowBridgeResult<CommandSuccess>> {
    const deleteOperation = async (): Promise<FlowBridgeResult<CommandSuccess>> => {
      try {
        const flowDir = join(this.workspaceRoot, '.flow')
        const epicsDir = join(flowDir, 'epics')
        const specsDir = join(flowDir, 'specs')
        const tasksDir = join(flowDir, 'tasks')

        // Delete epic JSON file
        const epicJsonPath = join(epicsDir, `${epicId}.json`)
        if (existsSync(epicJsonPath)) {
          unlinkSync(epicJsonPath)
        }

        // Delete epic spec file
        const epicSpecPath = join(specsDir, `${epicId}.md`)
        if (existsSync(epicSpecPath)) {
          unlinkSync(epicSpecPath)
        }

        // Delete all task files for this epic (pattern: <epicId>.<n>.json and <epicId>.<n>.md)
        if (existsSync(tasksDir)) {
          const taskFiles = readdirSync(tasksDir)
          for (const file of taskFiles) {
            if (file.startsWith(`${epicId}.`)) {
              unlinkSync(join(tasksDir, file))
            }
          }
        }

        return { ok: true, data: { success: true } }
      } catch (err) {
        return {
          ok: false,
          error: {
            type: 'command_failed' as const,
            exitCode: 1,
            stderr: err instanceof Error ? err.message : 'Failed to delete epic files',
          },
        }
      }
    }

    const promise = this.writeQueue.then(deleteOperation)
    this.writeQueue = promise.catch((err) => {
      console.error('[FlowBridge] Delete operation failed:', err)
    })
    return promise
  }

  /** Execute a write flowctl command with stdin input (for set-plan) */
  private execWriteWithStdin<T>(args: string[], stdin: string, schema: ZodSchema<T>): Promise<FlowBridgeResult<T>> {
    const promise = this.writeQueue.then(() => this.runCommandWithStdin(args, stdin, schema))
    this.writeQueue = promise.catch((err) => {
      console.error('[FlowBridge] Write operation failed:', err)
    })
    return promise
  }

  private runCommandWithStdin<T>(args: string[], stdin: string, schema: ZodSchema<T>): Promise<FlowBridgeResult<T>> {
    return new Promise((resolve) => {
      const flowctl = this.resolveFlowctl()
      const fullArgs = [...args, '--json']

      const child = execFile(
        flowctl,
        fullArgs,
        {
          cwd: this.workspaceRoot,
          timeout: TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          if (error) {
            if (error.killed || (error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
              return resolve({
                ok: false,
                error: { type: 'timeout', command: `flowctl ${args.join(' ')}` },
              })
            }
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              this.flowctlPath = null
              return resolve({ ok: false, error: { type: 'flowctl_not_found' } })
            }
            return resolve({
              ok: false,
              error: {
                type: 'command_failed',
                stderr: stderr || error.message,
                exitCode: error.code ? Number(error.code) : 1,
              },
            })
          }

          let parsed: unknown
          try {
            parsed = JSON.parse(stdout)
          } catch {
            return resolve({
              ok: false,
              error: {
                type: 'invalid_json',
                stdout: stdout.slice(0, 500),
              },
            })
          }

          const result = schema.safeParse(parsed)
          if (!result.success) {
            return resolve({
              ok: false,
              error: { type: 'invalid_output', zodError: result.error as ZodError },
            })
          }

          resolve({ ok: true, data: result.data })
        },
      )

      // Write to stdin and close
      if (child.stdin) {
        child.stdin.write(stdin)
        child.stdin.end()
      }
    })
  }
}
