import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type {
  SkillMomentRunCycleInput,
  SkillMomentRunCycleResult,
  SkillMomentRunJobAudit,
  SkillMomentRunJobFailure as SharedSkillMomentRunJobFailure,
  SkillMomentRunJobState as SharedSkillMomentRunJobState,
  SkillMomentRunStatusEvent,
} from '@craft-agent/shared/skill-moments'

import { appendJsonlRecord, readJsonlRecords, skillMomentsWorkspaceDir } from './storage'

export type SkillMomentRunStatusEmitter = (event: SkillMomentRunStatusEvent) => void

export type SkillMomentRunCycleExecutor = (
  input: SkillMomentRunCycleInput,
  emitStatus: SkillMomentRunStatusEmitter,
) => Promise<SkillMomentRunCycleResult>

export type SkillMomentRunJobState = SharedSkillMomentRunJobState

export type SkillMomentRunJobFailure = SharedSkillMomentRunJobFailure

export type SkillMomentRunJob = SkillMomentRunJobAudit

export type SkillMomentRunJobStartArgs = {
  input: SkillMomentRunCycleInput
  rootPath: string
  executor: SkillMomentRunCycleExecutor
  emitStatus?: SkillMomentRunStatusEmitter
}

export type SkillMomentRunJobManagerOptions = {
  maxEvents?: number
  maxJobs?: number
  recoveryExecutor?: SkillMomentRunCycleExecutor
  recoveryMode?: 'fail' | 'restart'
  emitRecoveredStatus?: SkillMomentRunStatusEmitter
}

export type SkillMomentRunJobGetArgs = {
  rootPath: string
  workspaceId: string
  runId: string
}

export type SkillMomentRunJobListArgs = {
  rootPath: string
  workspaceId: string
  roomId?: string
  limit?: number
}

export type SkillMomentRunJobWaitArgs = SkillMomentRunJobGetArgs & {
  timeoutMs?: number
}

const DEFAULT_MAX_RUN_JOB_EVENTS = 50
const DEFAULT_MAX_RUN_JOBS = 200
const RUN_JOB_AUDIT_SCHEMA_VERSION = 1
const RUN_JOB_AUDIT_KIND = 'skill-moment-run-job-audit'
const RUN_JOB_RECOVERY_FAILURE_CODE = 'recovered_without_executor'
const RUN_JOB_RECOVERY_RESTART_CODE = 'restarted_from_audit'
const RUN_JOB_RECOVERY_SOURCE = 'run-jobs.jsonl'

type SkillMomentRunJobAuditReason = 'start' | 'state' | 'event' | 'recovery' | 'final'

type SkillMomentRunJobAuditRecord = {
  schemaVersion: typeof RUN_JOB_AUDIT_SCHEMA_VERSION
  kind: typeof RUN_JOB_AUDIT_KIND
  reason: SkillMomentRunJobAuditReason
  recordedAt: string
  job: SkillMomentRunJobAudit
}

export function skillMomentRunJobsPath(rootPath: string): string {
  return join(skillMomentsWorkspaceDir(rootPath), 'run-jobs.jsonl')
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

function describeFailure(error: unknown): Omit<SkillMomentRunJobFailure, 'failedAt' | 'event'> {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    }
  }
  if (typeof error === 'string') {
    return { message: error }
  }
  try {
    return { message: JSON.stringify(error) }
  } catch {
    return { message: String(error) }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRunJobState(value: unknown): value is SkillMomentRunJobState {
  return value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed'
}

function isTerminalRunJob(job: SkillMomentRunJob): boolean {
  return job.state === 'succeeded' || job.state === 'failed'
}

function isRecoverableUnfinishedRunJob(job: SkillMomentRunJob): boolean {
  return job.state === 'queued' || job.state === 'running'
}

function cloneRunJob(job: SkillMomentRunJob): SkillMomentRunJob {
  return JSON.parse(JSON.stringify(job)) as SkillMomentRunJob
}

function normalizeRecoveredRunJob(value: unknown): SkillMomentRunJob | undefined {
  if (!isObject(value)) return undefined
  if (
    typeof value.runId !== 'string'
    || typeof value.workspaceId !== 'string'
    || typeof value.roomId !== 'string'
    || typeof value.startedAt !== 'string'
    || !isRunJobState(value.state)
  ) {
    return undefined
  }

  const events = Array.isArray(value.events)
    ? value.events.filter(isObject) as SkillMomentRunStatusEvent[]
    : []
  const eventCount = typeof value.eventCount === 'number' && Number.isFinite(value.eventCount)
    ? Math.max(0, Math.floor(value.eventCount))
    : events.length
  const droppedEventCount = typeof value.droppedEventCount === 'number' && Number.isFinite(value.droppedEventCount)
    ? Math.max(0, Math.floor(value.droppedEventCount))
    : 0
  const lastEvent = isObject(value.lastEvent) ? value.lastEvent as SkillMomentRunStatusEvent : events.at(-1)

  return {
    ...value,
    runId: value.runId,
    workspaceId: value.workspaceId,
    roomId: value.roomId,
    state: value.state,
    startedAt: value.startedAt,
    input: isObject(value.input) ? value.input as SkillMomentRunCycleInput : undefined,
    endedAt: typeof value.endedAt === 'string' ? value.endedAt : undefined,
    result: isObject(value.result) ? value.result as SkillMomentRunCycleResult : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
    failure: isObject(value.failure) ? value.failure as SkillMomentRunJobFailure : undefined,
    recovered: typeof value.recovered === 'boolean'
      ? value.recovered
      : (isObject(value.recovery) ? true : undefined),
    recovery: isObject(value.recovery) ? value.recovery as SkillMomentRunJob['recovery'] : undefined,
    eventCount,
    droppedEventCount,
    lastEvent,
    events,
  }
}

function runJobFromAuditRecord(record: unknown): SkillMomentRunJob | undefined {
  if (!isObject(record)) return undefined
  if ('job' in record) {
    return normalizeRecoveredRunJob(record.job)
  }
  return normalizeRecoveredRunJob(record)
}

function jobSortTimestamp(job: SkillMomentRunJob): string {
  return job.endedAt || job.lastEvent?.createdAt || job.startedAt
}

function compareJobsNewestFirst(left: SkillMomentRunJob, right: SkillMomentRunJob): number {
  return jobSortTimestamp(right).localeCompare(jobSortTimestamp(left))
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.floor(value))
}

export class SkillMomentRunJobManager {
  private jobs = new Map<string, SkillMomentRunJob>()
  private activeByRoom = new Map<string, string>()
  private doneByRun = new Map<string, Promise<void>>()
  private hydratedWorkspaces = new Set<string>()
  private jobRoots = new Map<string, string>()
  private persistenceByPath = new Map<string, Promise<void>>()
  private readonly maxEvents: number
  private readonly maxJobs: number
  private readonly recoveryExecutor?: SkillMomentRunCycleExecutor
  private readonly recoveryMode: 'fail' | 'restart'
  private readonly emitRecoveredStatus?: SkillMomentRunStatusEmitter

  constructor(options: SkillMomentRunJobManagerOptions = {}) {
    this.maxEvents = normalizePositiveInteger(options.maxEvents, DEFAULT_MAX_RUN_JOB_EVENTS)
    this.maxJobs = normalizePositiveInteger(options.maxJobs, DEFAULT_MAX_RUN_JOBS)
    this.recoveryExecutor = options.recoveryExecutor
    this.recoveryMode = options.recoveryMode ?? 'fail'
    this.emitRecoveredStatus = options.emitRecoveredStatus
  }

  startRun(args: SkillMomentRunJobStartArgs): SkillMomentRunCycleResult {
    const roomId = args.input.roomId?.trim() || 'debate'
    const lockKey = `${args.input.workspaceId}:${roomId}`
    if (this.activeByRoom.has(lockKey)) {
      throw new Error(`Skill Moments cycle already running for ${roomId}`)
    }

    const runId = args.input.runId || `moment-run-${Date.now()}-${randomUUID().slice(0, 8)}`
    if (this.jobs.has(runId)) {
      throw new Error(`Skill Moments run already exists: ${runId}`)
    }

    const startedAt = new Date().toISOString()
    const normalizedInput = { ...args.input, roomId, runId }
    const job: SkillMomentRunJob = {
      runId,
      workspaceId: args.input.workspaceId,
      roomId,
      state: 'queued',
      startedAt,
      input: normalizedInput,
      eventCount: 0,
      droppedEventCount: 0,
      events: [],
    }
    this.jobs.set(runId, job)
    this.jobRoots.set(runId, args.rootPath)
    this.activeByRoom.set(lockKey, runId)
    void this.enqueueAuditSnapshot(args.rootPath, 'start', job).catch(() => {})

    const emit = (event: SkillMomentRunStatusEvent): SkillMomentRunStatusEvent => {
      const normalized = {
        ...event,
        workspaceId: args.input.workspaceId,
        roomId,
        runId,
        createdAt: event.createdAt || new Date().toISOString(),
        sequence: job.eventCount + 1,
      }
      job.eventCount += 1
      job.lastEvent = normalized
      job.events.push(normalized)
      if (job.events.length > this.maxEvents) {
        const dropped = job.events.length - this.maxEvents
        job.events.splice(0, dropped)
        job.droppedEventCount += dropped
      }
      void this.enqueueAuditSnapshot(args.rootPath, 'event', job).catch(() => {})
      args.emitStatus?.(normalized)
      return normalized
    }

    emit({
      workspaceId: args.input.workspaceId,
      roomId,
      runId,
      phase: 'planning',
      message: '服务端任务已启动',
      detail: '后台继续生成朋友圈，客户端只订阅状态和完成后刷新列表。',
      createdAt: startedAt,
    })

    const done = new Promise<void>((resolve, reject) => {
      queueMicrotask(() => {
        void this.executeRun({
          rootPath: args.rootPath,
          input: normalizedInput,
          lockKey,
          job,
          executor: args.executor,
          emitStatus: emit,
        }).then(resolve, reject)
      })
    })
    this.doneByRun.set(runId, done)
    void done.finally(() => {
      this.doneByRun.delete(runId)
    }).catch(() => {})

    return {
      success: true,
      runId,
      state: 'started',
      moments: [],
      sourceDigests: [],
      path: skillMomentsWorkspaceDir(args.rootPath),
    }
  }

  getRun(runId: string): SkillMomentRunJob | undefined {
    return this.jobs.get(runId)
  }

  async getRunAudit(args: SkillMomentRunJobGetArgs): Promise<SkillMomentRunJob | undefined> {
    await this.hydrateWorkspace(args.rootPath, args.workspaceId)
    const job = this.jobs.get(args.runId)
    if (!job || !this.matchesWorkspace(job, args.rootPath, args.workspaceId)) {
      return undefined
    }
    return cloneRunJob(job)
  }

  async listRunAudits(args: SkillMomentRunJobListArgs): Promise<SkillMomentRunJob[]> {
    await this.hydrateWorkspace(args.rootPath, args.workspaceId)
    const limit = normalizeLimit(args.limit)
    const jobs = Array.from(this.jobs.values())
      .filter((job) => this.matchesWorkspace(job, args.rootPath, args.workspaceId))
      .filter((job) => !args.roomId || job.roomId === args.roomId)
      .sort(compareJobsNewestFirst)

    return (limit === undefined ? jobs : jobs.slice(0, limit)).map(cloneRunJob)
  }

  async waitForRunAudit(args: SkillMomentRunJobWaitArgs): Promise<SkillMomentRunJob> {
    await this.hydrateWorkspace(args.rootPath, args.workspaceId)
    const job = this.jobs.get(args.runId)
    if (!job || !this.matchesWorkspace(job, args.rootPath, args.workspaceId)) {
      throw new Error(`Skill Moments run not found: ${args.runId}`)
    }
    if (isTerminalRunJob(job) && !this.doneByRun.has(args.runId)) {
      return cloneRunJob(job)
    }
    if (!this.doneByRun.has(args.runId)) {
      throw new Error(`Skill Moments run is not active and has not reached a terminal state: ${args.runId}`)
    }

    const waited = await this.waitForRun(args.runId, args.timeoutMs)
    if (!this.matchesWorkspace(waited, args.rootPath, args.workspaceId)) {
      throw new Error(`Skill Moments run not found: ${args.runId}`)
    }
    return cloneRunJob(waited)
  }

  async waitForRun(runId: string, timeoutMs = 300_000): Promise<SkillMomentRunJob> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const job = this.jobs.get(runId)
      if (!job) {
        throw new Error(`Skill Moments run not found: ${runId}`)
      }
      if (isTerminalRunJob(job)) {
        const done = this.doneByRun.get(runId)
        if (done) {
          await done
        }
        return this.jobs.get(runId) ?? job
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Timed out waiting for Skill Moments run: ${runId}`)
  }

  private async hydrateWorkspace(rootPath: string, workspaceId: string): Promise<void> {
    const key = this.workspaceHydrationKey(rootPath, workspaceId)
    if (this.hydratedWorkspaces.has(key)) {
      return
    }

    const records = await readJsonlRecords<unknown>(skillMomentRunJobsPath(rootPath))
    const latestJobs = new Map<string, SkillMomentRunJob>()
    for (const record of records) {
      const job = runJobFromAuditRecord(record)
      if (!job || job.workspaceId !== workspaceId) {
        continue
      }
      latestJobs.set(job.runId, job)
    }

    const recoveredJobs: SkillMomentRunJob[] = []
    const restartedJobs: SkillMomentRunJob[] = []
    for (const job of latestJobs.values()) {
      if (this.doneByRun.has(job.runId)) {
        continue
      }
      if (isRecoverableUnfinishedRunJob(job)) {
        if (this.recoveryMode === 'restart' && this.recoveryExecutor && job.input) {
          restartedJobs.push(job)
        } else {
          recoveredJobs.push(this.markRecoveredWithoutExecutor(job))
        }
      }
      this.jobs.set(job.runId, job)
      this.jobRoots.set(job.runId, rootPath)
    }

    this.hydratedWorkspaces.add(key)
    this.trimRecoveredJobs(rootPath, workspaceId)
    for (const job of restartedJobs) {
      this.restartRecoveredWithExecutor(rootPath, job)
    }
    for (const job of recoveredJobs) {
      await this.enqueueAuditSnapshot(rootPath, 'recovery', job)
      await this.enqueueAuditSnapshot(rootPath, 'final', job)
    }
  }

  private restartRecoveredWithExecutor(rootPath: string, job: SkillMomentRunJob): void {
    const previousState = job.state
    const recoveredAt = new Date().toISOString()
    const message = 'Skill Moments run was restarted from run-jobs.jsonl with the configured executor.'
    const lockKey = `${job.workspaceId}:${job.roomId}`
    const recoveryEvent: SkillMomentRunStatusEvent = {
      workspaceId: job.workspaceId,
      roomId: job.roomId,
      runId: job.runId,
      phase: 'planning',
      message: '恢复运行任务并重新执行',
      detail: '进程重启后读取 run-jobs.jsonl，使用原始 input 重新启动本轮生成。',
      createdAt: recoveredAt,
      sequence: job.eventCount + 1,
    }

    job.eventCount += 1
    job.lastEvent = recoveryEvent
    job.events.push(recoveryEvent)
    if (job.events.length > this.maxEvents) {
      const dropped = job.events.length - this.maxEvents
      job.events.splice(0, dropped)
      job.droppedEventCount += dropped
    }
    job.recovered = true
    job.recovery = {
      code: RUN_JOB_RECOVERY_RESTART_CODE,
      source: RUN_JOB_RECOVERY_SOURCE,
      recoveredAt,
      previousState,
      message,
    }
    job.error = undefined
    job.failure = undefined
    job.endedAt = undefined
    this.activeByRoom.set(lockKey, job.runId)
    void this.enqueueAuditSnapshot(rootPath, 'recovery', job).catch(() => {})
    this.emitRecoveredStatus?.(recoveryEvent)

    const input = { ...job.input!, roomId: job.roomId, runId: job.runId }
    const emit = (event: SkillMomentRunStatusEvent): SkillMomentRunStatusEvent => {
      const normalized = {
        ...event,
        workspaceId: job.workspaceId,
        roomId: job.roomId,
        runId: job.runId,
        createdAt: event.createdAt || new Date().toISOString(),
        sequence: job.eventCount + 1,
      }
      job.eventCount += 1
      job.lastEvent = normalized
      job.events.push(normalized)
      if (job.events.length > this.maxEvents) {
        const dropped = job.events.length - this.maxEvents
        job.events.splice(0, dropped)
        job.droppedEventCount += dropped
      }
      void this.enqueueAuditSnapshot(rootPath, 'event', job).catch(() => {})
      this.emitRecoveredStatus?.(normalized)
      return normalized
    }

    const done = new Promise<void>((resolve, reject) => {
      queueMicrotask(() => {
        void this.executeRun({
          rootPath,
          input,
          lockKey,
          job,
          executor: this.recoveryExecutor!,
          emitStatus: emit,
        }).then(resolve, reject)
      })
    })
    this.doneByRun.set(job.runId, done)
    void done.finally(() => {
      this.doneByRun.delete(job.runId)
    }).catch(() => {})
  }

  private markRecoveredWithoutExecutor(job: SkillMomentRunJob): SkillMomentRunJob {
    const previousState = job.state
    const recoveredAt = new Date().toISOString()
    const message = 'Skill Moments run was recovered from run-jobs.jsonl without a live executor.'
    const detail = '进程重启后没有 live executor 可继续执行，任务已标记为失败。'
    const recoveryEvent: SkillMomentRunStatusEvent = {
      workspaceId: job.workspaceId,
      roomId: job.roomId,
      runId: job.runId,
      phase: 'error',
      message: '恢复运行任务失败',
      detail,
      failureEvidence: `${RUN_JOB_RECOVERY_FAILURE_CODE}: ${message}`,
      createdAt: recoveredAt,
      sequence: job.eventCount + 1,
    }

    job.eventCount += 1
    job.lastEvent = recoveryEvent
    job.events.push(recoveryEvent)
    if (job.events.length > this.maxEvents) {
      const dropped = job.events.length - this.maxEvents
      job.events.splice(0, dropped)
      job.droppedEventCount += dropped
    }

    job.state = 'failed'
    job.endedAt = recoveredAt
    job.error = message
    job.recovered = true
    job.recovery = {
      code: RUN_JOB_RECOVERY_FAILURE_CODE,
      source: RUN_JOB_RECOVERY_SOURCE,
      recoveredAt,
      previousState,
      message,
    }
    job.failure = {
      code: RUN_JOB_RECOVERY_FAILURE_CODE,
      message,
      name: 'SkillMomentRunJobRecoveryError',
      failedAt: recoveredAt,
      event: recoveryEvent,
    }
    return job
  }

  private workspaceHydrationKey(rootPath: string, workspaceId: string): string {
    return `${workspaceId}:${skillMomentRunJobsPath(rootPath)}`
  }

  private matchesWorkspace(job: SkillMomentRunJob, rootPath: string, workspaceId: string): boolean {
    const jobRoot = this.jobRoots.get(job.runId)
    return job.workspaceId === workspaceId && (!jobRoot || jobRoot === rootPath)
  }

  private trimRecoveredJobs(rootPath: string, workspaceId: string): void {
    const jobs = Array.from(this.jobs.values())
      .filter((job) => this.matchesWorkspace(job, rootPath, workspaceId))
      .sort(compareJobsNewestFirst)
    let kept = 0
    for (const job of jobs) {
      if (this.doneByRun.has(job.runId)) {
        continue
      }
      kept += 1
      if (kept > this.maxJobs) {
        this.jobs.delete(job.runId)
        this.jobRoots.delete(job.runId)
      }
    }
  }

  private enqueueAuditSnapshot(
    rootPath: string,
    reason: SkillMomentRunJobAuditReason,
    job: SkillMomentRunJob,
  ): Promise<void> {
    const filePath = skillMomentRunJobsPath(rootPath)
    const previous = this.persistenceByPath.get(filePath) ?? Promise.resolve()
    const record: SkillMomentRunJobAuditRecord = {
      schemaVersion: RUN_JOB_AUDIT_SCHEMA_VERSION,
      kind: RUN_JOB_AUDIT_KIND,
      reason,
      recordedAt: new Date().toISOString(),
      job: cloneRunJob(job),
    }
    const next = previous
      .catch(() => undefined)
      .then(() => appendJsonlRecord(filePath, record))
    this.persistenceByPath.set(filePath, next)
    return next
  }

  private async executeRun(args: {
    rootPath: string
    input: SkillMomentRunCycleInput
    lockKey: string
    job: SkillMomentRunJob
    executor: SkillMomentRunCycleExecutor
    emitStatus: (event: SkillMomentRunStatusEvent) => SkillMomentRunStatusEvent
  }): Promise<void> {
    args.job.state = 'running'
    void this.enqueueAuditSnapshot(args.rootPath, 'state', args.job).catch(() => {})
    try {
      const result = await args.executor(args.input, args.emitStatus)
      args.job.endedAt = new Date().toISOString()
      if (!result.success) {
        const message = 'Skill Moments executor returned success=false'
        args.job.state = 'failed'
        args.job.result = { ...result, state: 'failed' }
        const failureEvent = args.emitStatus({
          workspaceId: args.input.workspaceId,
          roomId: args.input.roomId?.trim() || 'debate',
          runId: args.input.runId,
          phase: 'error',
          message: '生成一轮失败',
          detail: message,
          failureEvidence: JSON.stringify({ runId: result.runId, path: result.path }),
          createdAt: args.job.endedAt,
        })
        args.job.error = message
        args.job.failure = {
          message,
          failedAt: args.job.endedAt,
          event: failureEvent,
        }
        return
      }

      args.job.state = 'succeeded'
      args.job.result = { ...result, state: 'completed' }
      if (!args.job.events.some((event) => event.phase === 'complete')) {
        args.emitStatus({
          workspaceId: args.input.workspaceId,
          roomId: args.input.roomId?.trim() || 'debate',
          runId: args.input.runId,
          phase: 'complete',
          message: '本轮朋友圈已完成',
          detail: `生成 ${result.moments.length} 条主贴。`,
          createdAt: args.job.endedAt,
        })
      }
    } catch (error) {
      const failure = describeFailure(error)
      args.job.state = 'failed'
      args.job.endedAt = new Date().toISOString()
      const failureEvent = args.emitStatus({
        workspaceId: args.input.workspaceId,
        roomId: args.input.roomId?.trim() || 'debate',
        runId: args.input.runId,
        phase: 'error',
        message: '生成一轮失败',
        detail: failure.message,
        failureEvidence: failure.stack || failure.message,
        createdAt: args.job.endedAt,
      })
      args.job.error = failure.message
      args.job.failure = {
        ...failure,
        failedAt: args.job.endedAt,
        event: failureEvent,
      }
    } finally {
      try {
        if (isTerminalRunJob(args.job)) {
          await this.enqueueAuditSnapshot(args.rootPath, 'final', args.job)
        }
      } finally {
        this.activeByRoom.delete(args.lockKey)
      }
    }
  }
}
