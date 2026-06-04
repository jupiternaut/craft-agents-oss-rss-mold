import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SkillMomentRunJobManager, skillMomentRunJobsPath } from './jobs'

type PersistedRunJobAuditRecord = {
  reason: string
  job: {
    runId: string
    state: string
    eventCount: number
    events: Array<{ phase: string }>
    lastEvent?: { phase: string; failureEvidence?: string }
    failure?: { code?: string; message: string }
    recovered?: boolean
    recovery?: {
      code: string
      source: string
      recoveredAt: string
      previousState: string
    }
  }
}

function makeWorkspace(): string {
  const root = join(tmpdir(), `craft-skill-moments-jobs-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(root, { recursive: true })
  return root
}

function readRunJobAuditRecords(root: string): PersistedRunJobAuditRecord[] {
  return readFileSync(skillMomentRunJobsPath(root), 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PersistedRunJobAuditRecord)
}

async function waitForRunJobAuditRecords(
  root: string,
  predicate: (records: PersistedRunJobAuditRecord[]) => boolean,
): Promise<PersistedRunJobAuditRecord[]> {
  const startedAt = Date.now()
  let records: PersistedRunJobAuditRecord[] = []
  while (Date.now() - startedAt < 1_000) {
    if (existsSync(skillMomentRunJobsPath(root))) {
      records = readRunJobAuditRecords(root)
      if (predicate(records)) {
        return records
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for run job audit records. Last records: ${JSON.stringify(records)}`)
}

describe('SkillMomentRunJobManager', () => {
  it('starts a run asynchronously and records status events', async () => {
    const root = makeWorkspace()
    const events: string[] = []
    try {
      const manager = new SkillMomentRunJobManager()
      const started = manager.startRun({
        rootPath: root,
        input: { workspaceId: 'workspace-1', roomId: 'debate' },
        emitStatus: (event) => events.push(event.phase),
        executor: async (input, emitStatus) => {
          emitStatus({
            workspaceId: input.workspaceId,
            roomId: input.roomId || 'debate',
            runId: input.runId,
            phase: 'writing',
            message: 'writing',
            createdAt: new Date().toISOString(),
          })
          return {
            success: true,
            runId: input.runId!,
            moments: [],
            sourceDigests: [],
            path: root,
          }
        },
      })

      expect(started.state).toBe('started')
      expect(started.moments).toEqual([])

      const job = await manager.waitForRun(started.runId)
      expect(job.state).toBe('succeeded')
      expect(job.result?.state).toBe('completed')
      expect(job.eventCount).toBe(3)
      expect(job.droppedEventCount).toBe(0)
      expect(job.events.map((event) => event.phase)).toEqual(['planning', 'writing', 'complete'])
      expect(job.events.map((event) => event.sequence)).toEqual([1, 2, 3])
      expect(job.events.some((event) => event.phase === 'writing')).toBe(true)
      expect(job.events.some((event) => event.phase === 'complete')).toBe(true)
      expect(events).toContain('planning')
      expect(events).toContain('writing')
      expect(events).toContain('complete')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('persists run audits and recovers completed jobs in a new manager', async () => {
    const root = makeWorkspace()
    try {
      const manager = new SkillMomentRunJobManager()
      const started = manager.startRun({
        rootPath: root,
        input: { workspaceId: 'workspace-1', roomId: 'debate', runId: 'persisted-run-1' },
        executor: async (input, emitStatus) => {
          emitStatus({
            workspaceId: input.workspaceId,
            roomId: input.roomId || 'debate',
            runId: input.runId,
            phase: 'writing',
            message: 'writing',
            createdAt: new Date().toISOString(),
          })
          return {
            success: true,
            runId: input.runId!,
            moments: [],
            sourceDigests: [],
            path: root,
          }
        },
      })

      const job = await manager.waitForRun(started.runId)
      expect(job.state).toBe('succeeded')

      const records = readRunJobAuditRecords(root)
      expect(records.length).toBeGreaterThanOrEqual(5)
      expect(records.map((record) => record.reason)).toContain('start')
      expect(records.map((record) => record.reason)).toContain('event')
      expect(records.at(-1)?.reason).toBe('final')
      expect(records.at(-1)?.job.state).toBe('succeeded')

      const rebuilt = new SkillMomentRunJobManager()
      const listed = await rebuilt.listRunAudits({
        rootPath: root,
        workspaceId: 'workspace-1',
      })
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({
        runId: 'persisted-run-1',
        state: 'succeeded',
        eventCount: 3,
      })

      const recovered = await rebuilt.getRunAudit({
        rootPath: root,
        workspaceId: 'workspace-1',
        runId: 'persisted-run-1',
      })
      expect(recovered?.events.map((event) => event.phase)).toEqual(['planning', 'writing', 'complete'])

      const waited = await rebuilt.waitForRunAudit({
        rootPath: root,
        workspaceId: 'workspace-1',
        runId: 'persisted-run-1',
      })
      expect(waited.state).toBe('succeeded')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('recovers unfinished running jobs as failed without waiting for a missing executor', async () => {
    const root = makeWorkspace()
    try {
      const manager = new SkillMomentRunJobManager()
      const started = manager.startRun({
        rootPath: root,
        input: { workspaceId: 'workspace-1', roomId: 'debate', runId: 'unfinished-run-1' },
        executor: async () => await new Promise<never>(() => {}),
      })

      await waitForRunJobAuditRecords(root, (records) => records.some((record) => (
        record.job.runId === started.runId && record.job.state === 'running'
      )))

      const rebuilt = new SkillMomentRunJobManager()
      const listed = await rebuilt.listRunAudits({
        rootPath: root,
        workspaceId: 'workspace-1',
        roomId: 'debate',
      })
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({
        runId: 'unfinished-run-1',
        state: 'failed',
        recovered: true,
        recovery: {
          code: 'recovered_without_executor',
          source: 'run-jobs.jsonl',
          previousState: 'running',
        },
        failure: {
          code: 'recovered_without_executor',
          name: 'SkillMomentRunJobRecoveryError',
        },
      })
      expect(listed[0]!.endedAt).toBe(listed[0]!.recovery?.recoveredAt)
      expect(listed[0]!.lastEvent?.phase).toBe('error')
      expect(listed[0]!.lastEvent?.failureEvidence).toContain('recovered_without_executor')

      const got = await rebuilt.getRunAudit({
        rootPath: root,
        workspaceId: 'workspace-1',
        runId: started.runId,
      })
      expect(got).toMatchObject({
        runId: 'unfinished-run-1',
        state: 'failed',
        recovered: true,
      })

      const waited = await rebuilt.waitForRunAudit({
        rootPath: root,
        workspaceId: 'workspace-1',
        runId: started.runId,
        timeoutMs: 10,
      })
      expect(waited.state).toBe('failed')
      expect(waited.failure?.code).toBe('recovered_without_executor')

      const records = await waitForRunJobAuditRecords(root, (auditRecords) => auditRecords.some((record) => (
        record.reason === 'recovery'
        && record.job.runId === started.runId
        && record.job.failure?.code === 'recovered_without_executor'
      )))
      expect(records.some((record) => record.reason === 'recovery')).toBe(true)
      expect(records.at(-1)?.job.state).toBe('failed')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('restarts unfinished running jobs when a recovery executor is configured', async () => {
    const root = makeWorkspace()
    try {
      const manager = new SkillMomentRunJobManager()
      const started = manager.startRun({
        rootPath: root,
        input: { workspaceId: 'workspace-1', roomId: 'debate', runId: 'restartable-run-1' },
        executor: async () => await new Promise<never>(() => {}),
      })

      await waitForRunJobAuditRecords(root, (records) => records.some((record) => (
        record.job.runId === started.runId && record.job.state === 'running'
      )))

      const recoveredEvents: string[] = []
      const rebuilt = new SkillMomentRunJobManager({
        recoveryMode: 'restart',
        recoveryExecutor: async (input, emitStatus) => {
          recoveredEvents.push(`executor:${input.runId}`)
          emitStatus({
            workspaceId: input.workspaceId,
            roomId: input.roomId || 'debate',
            runId: input.runId,
            phase: 'writing',
            message: 'restarted writing',
            createdAt: new Date().toISOString(),
          })
          return {
            success: true,
            runId: input.runId!,
            moments: [],
            sourceDigests: [],
            path: root,
          }
        },
        emitRecoveredStatus: (event) => recoveredEvents.push(event.phase),
      })

      const listed = await rebuilt.listRunAudits({
        rootPath: root,
        workspaceId: 'workspace-1',
        roomId: 'debate',
      })
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({
        runId: 'restartable-run-1',
        recovered: true,
        recovery: {
          code: 'restarted_from_audit',
          source: 'run-jobs.jsonl',
          previousState: 'running',
        },
      })

      const waited = await rebuilt.waitForRunAudit({
        rootPath: root,
        workspaceId: 'workspace-1',
        runId: started.runId,
        timeoutMs: 1_000,
      })
      expect(waited.state).toBe('succeeded')
      expect(waited.recovered).toBe(true)
      expect(waited.recovery?.code).toBe('restarted_from_audit')
      expect(waited.events.map((event) => event.phase)).toContain('writing')
      expect(recoveredEvents).toContain('planning')
      expect(recoveredEvents).toContain('executor:restartable-run-1')

      const records = await waitForRunJobAuditRecords(root, (auditRecords) => auditRecords.some((record) => (
        record.reason === 'final'
        && record.job.runId === started.runId
        && record.job.state === 'succeeded'
        && record.job.recovery?.code === 'restarted_from_audit'
      )))
      expect(records.some((record) => record.reason === 'recovery')).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps a bounded chronological event audit', async () => {
    const root = makeWorkspace()
    try {
      const manager = new SkillMomentRunJobManager({ maxEvents: 3 })
      const started = manager.startRun({
        rootPath: root,
        input: { workspaceId: 'workspace-1', roomId: 'debate' },
        executor: async (input, emitStatus) => {
          for (let index = 1; index <= 5; index += 1) {
            emitStatus({
              workspaceId: input.workspaceId,
              roomId: input.roomId || 'debate',
              runId: input.runId,
              phase: 'writing',
              message: `writing-${index}`,
              createdAt: new Date().toISOString(),
            })
          }
          return {
            success: true,
            runId: input.runId!,
            moments: [],
            sourceDigests: [],
            path: root,
          }
        },
      })

      const job = await manager.waitForRun(started.runId)

      expect(job.state).toBe('succeeded')
      expect(job.eventCount).toBe(7)
      expect(job.droppedEventCount).toBe(4)
      expect(job.events.map((event) => event.message)).toEqual([
        'writing-4',
        'writing-5',
        '本轮朋友圈已完成',
      ])
      expect(job.events.map((event) => event.sequence)).toEqual([5, 6, 7])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('records a structured failure event and releases the room lock', async () => {
    const root = makeWorkspace()
    try {
      const manager = new SkillMomentRunJobManager()
      const started = manager.startRun({
        rootPath: root,
        input: { workspaceId: 'workspace-1', roomId: 'debate' },
        executor: async (input, emitStatus) => {
          emitStatus({
            workspaceId: input.workspaceId,
            roomId: input.roomId || 'debate',
            runId: input.runId,
            phase: 'browser_error',
            message: 'browser failed',
            detail: 'prompt input missing',
            failureEvidence: 'selector #prompt-textarea not found',
            createdAt: new Date().toISOString(),
          })
          throw new Error('ChatGPT prompt input not found')
        },
      })

      const failed = await manager.waitForRun(started.runId)
      expect(failed.state).toBe('failed')
      expect(failed.result).toBeUndefined()
      expect(failed.error).toBe('ChatGPT prompt input not found')
      expect(failed.failure?.message).toBe('ChatGPT prompt input not found')
      expect(failed.failure?.event.phase).toBe('error')
      expect(failed.failure?.event.detail).toBe('ChatGPT prompt input not found')
      expect(failed.failure?.event.failureEvidence).toContain('ChatGPT prompt input not found')
      expect(failed.events.map((event) => event.phase)).toEqual(['planning', 'browser_error', 'error'])

      const records = readRunJobAuditRecords(root)
      expect(records.at(-1)?.reason).toBe('final')
      expect(records.at(-1)?.job.state).toBe('failed')
      expect(records.at(-1)?.job.failure?.message).toBe('ChatGPT prompt input not found')

      const rebuilt = new SkillMomentRunJobManager()
      const recovered = await rebuilt.getRunAudit({
        rootPath: root,
        workspaceId: 'workspace-1',
        runId: started.runId,
      })
      expect(recovered?.state).toBe('failed')
      expect(recovered?.failure?.message).toBe('ChatGPT prompt input not found')

      const retry = manager.startRun({
        rootPath: root,
        input: { workspaceId: 'workspace-1', roomId: 'debate' },
        executor: async (input) => ({
          success: true,
          runId: input.runId!,
          moments: [],
          sourceDigests: [],
          path: root,
        }),
      })
      const retried = await manager.waitForRun(retry.runId)
      expect(retried.state).toBe('succeeded')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('treats success=false executor results as failed jobs', async () => {
    const root = makeWorkspace()
    try {
      const manager = new SkillMomentRunJobManager()
      const started = manager.startRun({
        rootPath: root,
        input: { workspaceId: 'workspace-1', roomId: 'debate' },
        executor: async (input) => ({
          success: false,
          runId: input.runId!,
          moments: [],
          sourceDigests: [],
          path: root,
        }),
      })

      const job = await manager.waitForRun(started.runId)
      expect(job.state).toBe('failed')
      expect(job.result?.state).toBe('failed')
      expect(job.failure?.event.phase).toBe('error')
      expect(job.events.map((event) => event.phase)).toEqual(['planning', 'error'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects concurrent runs for the same workspace room', async () => {
    const root = makeWorkspace()
    try {
      const manager = new SkillMomentRunJobManager()
      const started = manager.startRun({
        rootPath: root,
        input: { workspaceId: 'workspace-1', roomId: 'debate' },
        executor: async (input) => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return {
            success: true,
            runId: input.runId!,
            moments: [],
            sourceDigests: [],
            path: root,
          }
        },
      })

      expect(() => manager.startRun({
        rootPath: root,
        input: { workspaceId: 'workspace-1', roomId: 'debate' },
        executor: async (input) => ({
          success: true,
          runId: input.runId!,
          moments: [],
          sourceDigests: [],
          path: root,
        }),
      })).toThrow('already running')

      await manager.waitForRun(started.runId)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
