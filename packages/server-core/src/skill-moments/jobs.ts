import { randomUUID } from 'node:crypto'

import type {
  SkillMomentRunCycleInput,
  SkillMomentRunCycleResult,
  SkillMomentRunStatusEvent,
} from '@craft-agent/shared/skill-moments'

import { skillMomentsWorkspaceDir } from './storage'

export type SkillMomentRunStatusEmitter = (event: SkillMomentRunStatusEvent) => void

export type SkillMomentRunCycleExecutor = (
  input: SkillMomentRunCycleInput,
  emitStatus: SkillMomentRunStatusEmitter,
) => Promise<SkillMomentRunCycleResult>

export type SkillMomentRunJobState = 'queued' | 'running' | 'succeeded' | 'failed'

export type SkillMomentRunJob = {
  runId: string
  workspaceId: string
  roomId: string
  state: SkillMomentRunJobState
  startedAt: string
  endedAt?: string
  result?: SkillMomentRunCycleResult
  error?: string
  events: SkillMomentRunStatusEvent[]
}

export type SkillMomentRunJobStartArgs = {
  input: SkillMomentRunCycleInput
  rootPath: string
  executor: SkillMomentRunCycleExecutor
  emitStatus?: SkillMomentRunStatusEmitter
}

export class SkillMomentRunJobManager {
  private jobs = new Map<string, SkillMomentRunJob>()
  private activeByRoom = new Map<string, string>()

  startRun(args: SkillMomentRunJobStartArgs): SkillMomentRunCycleResult {
    const roomId = args.input.roomId?.trim() || 'debate'
    const lockKey = `${args.input.workspaceId}:${roomId}`
    if (this.activeByRoom.has(lockKey)) {
      throw new Error(`Skill Moments cycle already running for ${roomId}`)
    }

    const runId = args.input.runId || `moment-run-${Date.now()}-${randomUUID().slice(0, 8)}`
    const startedAt = new Date().toISOString()
    const job: SkillMomentRunJob = {
      runId,
      workspaceId: args.input.workspaceId,
      roomId,
      state: 'queued',
      startedAt,
      events: [],
    }
    this.jobs.set(runId, job)
    this.activeByRoom.set(lockKey, runId)

    const emit = (event: SkillMomentRunStatusEvent) => {
      const normalized = {
        ...event,
        workspaceId: args.input.workspaceId,
        roomId,
        runId,
      }
      job.events.unshift(normalized)
      job.events = job.events.slice(0, 50)
      args.emitStatus?.(normalized)
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

    queueMicrotask(() => {
      void this.executeRun({
        input: { ...args.input, roomId, runId },
        lockKey,
        job,
        executor: args.executor,
        emitStatus: emit,
      })
    })

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

  async waitForRun(runId: string, timeoutMs = 300_000): Promise<SkillMomentRunJob> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const job = this.jobs.get(runId)
      if (!job) {
        throw new Error(`Skill Moments run not found: ${runId}`)
      }
      if (job.state === 'succeeded' || job.state === 'failed') {
        return job
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Timed out waiting for Skill Moments run: ${runId}`)
  }

  private async executeRun(args: {
    input: SkillMomentRunCycleInput
    lockKey: string
    job: SkillMomentRunJob
    executor: SkillMomentRunCycleExecutor
    emitStatus: SkillMomentRunStatusEmitter
  }): Promise<void> {
    args.job.state = 'running'
    try {
      const result = await args.executor(args.input, args.emitStatus)
      args.job.state = 'succeeded'
      args.job.result = { ...result, state: 'completed' }
      args.job.endedAt = new Date().toISOString()
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
      const message = error instanceof Error ? error.message : String(error)
      args.job.state = 'failed'
      args.job.error = message
      args.job.endedAt = new Date().toISOString()
      args.emitStatus({
        workspaceId: args.input.workspaceId,
        roomId: args.input.roomId?.trim() || 'debate',
        runId: args.input.runId,
        phase: 'error',
        message: '刷新朋友圈失败',
        detail: message,
        createdAt: args.job.endedAt,
      })
    } finally {
      this.activeByRoom.delete(args.lockKey)
    }
  }
}
