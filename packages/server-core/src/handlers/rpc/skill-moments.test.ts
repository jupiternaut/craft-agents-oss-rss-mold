import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { skillMomentRunJobsPath } from '../../skill-moments'

let workspaceRoot = ''

type PersistedRunJobAuditRecord = {
  reason: string
  job: {
    runId: string
    state: string
  }
}

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (workspaceId: string) => (
    workspaceId === 'workspace-1'
      ? { id: 'workspace-1', name: 'Workspace 1', rootPath: workspaceRoot }
      : undefined
  ),
}))

function createDeps(overrides?: Partial<HandlerDeps>): HandlerDeps {
  return {
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
    ...overrides,
  }
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

async function createHarness(deps: HandlerDeps) {
  const handlers = new Map<string, HandlerFn>()
  const pushCalls: Array<{ channel: string; target: unknown; args: unknown[] }> = []
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push(channel, target, ...args) {
      pushCalls.push({ channel, target, args })
    },
    async invokeClient() {
      return undefined
    },
    hasClientCapability() {
      return false
    },
    findClientsWithCapability() {
      return []
    },
  }
  const { registerSkillMomentsHandlers } = await import('./skill-moments')
  registerSkillMomentsHandlers(server, deps)
  const runCycle = handlers.get(RPC_CHANNELS.skillMoments.RUN_CYCLE)
  if (!runCycle) {
    throw new Error('RUN_CYCLE handler not registered')
  }
  const getRunJob = handlers.get(RPC_CHANNELS.skillMoments.GET_RUN_JOB)
  if (!getRunJob) {
    throw new Error('GET_RUN_JOB handler not registered')
  }
  const listRunJobs = handlers.get(RPC_CHANNELS.skillMoments.LIST_RUN_JOBS)
  if (!listRunJobs) {
    throw new Error('LIST_RUN_JOBS handler not registered')
  }
  const waitRunJob = handlers.get(RPC_CHANNELS.skillMoments.WAIT_RUN_JOB)
  if (!waitRunJob) {
    throw new Error('WAIT_RUN_JOB handler not registered')
  }
  const recordFeedback = handlers.get(RPC_CHANNELS.skillMoments.RECORD_FEEDBACK)
  if (!recordFeedback) {
    throw new Error('RECORD_FEEDBACK handler not registered')
  }
  const listEvolutionCandidates = handlers.get(RPC_CHANNELS.skillMoments.LIST_EVOLUTION_CANDIDATES)
  if (!listEvolutionCandidates) {
    throw new Error('LIST_EVOLUTION_CANDIDATES handler not registered')
  }
  const reviewEvolutionCandidate = handlers.get(RPC_CHANNELS.skillMoments.REVIEW_EVOLUTION_CANDIDATE)
  if (!reviewEvolutionCandidate) {
    throw new Error('REVIEW_EVOLUTION_CANDIDATE handler not registered')
  }
  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: 'workspace-1',
    webContentsId: 101,
  }
  return {
    runCycle,
    getRunJob,
    listRunJobs,
    waitRunJob,
    recordFeedback,
    listEvolutionCandidates,
    reviewEvolutionCandidate,
    ctx,
    pushCalls,
  }
}

describe('registerSkillMomentsHandlers RUN_CYCLE', () => {
  beforeEach(() => {
    workspaceRoot = join(tmpdir(), `craft-skill-moments-handler-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(workspaceRoot, { recursive: true })
  })

  it('starts an async run and pushes status events to the requesting client', async () => {
    try {
      const { runCycle, ctx, pushCalls } = await createHarness(createDeps({
        skillMomentRunCycleExecutor: async (input, emitStatus) => {
          emitStatus({
            workspaceId: input.workspaceId,
            roomId: input.roomId || 'debate',
            runId: input.runId,
            phase: 'writing',
            message: 'writing',
            createdAt: new Date().toISOString(),
          })
          emitStatus({
            workspaceId: input.workspaceId,
            roomId: input.roomId || 'debate',
            runId: input.runId,
            phase: 'complete',
            message: 'done',
            createdAt: new Date().toISOString(),
          })
          return {
            success: true,
            runId: input.runId!,
            moments: [],
            sourceDigests: [],
            path: workspaceRoot,
          }
        },
      }))

      const result = await runCycle(ctx, {
        workspaceId: 'workspace-1',
        roomId: 'debate',
        runId: 'run-1',
      })
      expect(result).toMatchObject({
        success: true,
        runId: 'run-1',
        state: 'started',
        moments: [],
      })

      await new Promise((resolve) => setTimeout(resolve, 25))

      expect(pushCalls.map((call) => call.channel)).toEqual([
        RPC_CHANNELS.skillMoments.RUN_STATUS,
        RPC_CHANNELS.skillMoments.RUN_STATUS,
        RPC_CHANNELS.skillMoments.RUN_STATUS,
      ])
      expect(pushCalls[0]!.target).toEqual({ to: 'client', clientId: 'client-1' })
      expect(pushCalls.map((call) => (call.args[0] as { phase: string }).phase)).toEqual([
        'planning',
        'writing',
        'complete',
      ])
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('gets, lists, and waits for run jobs through RPC handlers', async () => {
    try {
      const {
        runCycle,
        getRunJob,
        listRunJobs,
        waitRunJob,
        ctx,
      } = await createHarness(createDeps({
        skillMomentRunCycleExecutor: async (input, emitStatus) => {
          emitStatus({
            workspaceId: input.workspaceId,
            roomId: input.roomId || 'debate',
            runId: input.runId,
            phase: 'writing',
            message: 'writing',
            createdAt: new Date().toISOString(),
          })
          await new Promise((resolve) => setTimeout(resolve, 10))
          return {
            success: true,
            runId: input.runId!,
            moments: [],
            sourceDigests: [],
            path: workspaceRoot,
          }
        },
      }))

      await runCycle(ctx, {
        workspaceId: 'workspace-1',
        roomId: 'debate',
        runId: 'rpc-run-1',
      })

      const waited = await waitRunJob(ctx, {
        workspaceId: 'workspace-1',
        runId: 'rpc-run-1',
        timeoutMs: 1_000,
      }) as { job: { runId: string; state: string; eventCount: number } }
      expect(waited.job).toMatchObject({
        runId: 'rpc-run-1',
        state: 'succeeded',
        eventCount: 3,
      })

      const got = await getRunJob(ctx, {
        workspaceId: 'workspace-1',
        runId: 'rpc-run-1',
      }) as { job?: { runId: string; state: string } }
      expect(got.job).toMatchObject({
        runId: 'rpc-run-1',
        state: 'succeeded',
      })

      const listed = await listRunJobs(ctx, {
        workspaceId: 'workspace-1',
        roomId: 'debate',
        limit: 10,
      }) as { jobs: Array<{ runId: string; state: string }> }
      expect(listed.jobs.map((job) => job.runId)).toEqual(['rpc-run-1'])

      const restarted = await createHarness(createDeps())
      const recoveredList = await restarted.listRunJobs(ctx, {
        workspaceId: 'workspace-1',
        roomId: 'debate',
      }) as { jobs: Array<{ runId: string; state: string }> }
      expect(recoveredList.jobs).toHaveLength(1)
      expect(recoveredList.jobs[0]).toMatchObject({
        runId: 'rpc-run-1',
        state: 'succeeded',
      })

      const recoveredWait = await restarted.waitRunJob(ctx, {
        workspaceId: 'workspace-1',
        runId: 'rpc-run-1',
      }) as { job: { runId: string; state: string } }
      expect(recoveredWait.job).toMatchObject({
        runId: 'rpc-run-1',
        state: 'succeeded',
      })
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('recovers unfinished run jobs through RPC handlers after restart', async () => {
    try {
      const first = await createHarness(createDeps({
        skillMomentRunCycleExecutor: async () => await new Promise<never>(() => {}),
      }))

      await first.runCycle(first.ctx, {
        workspaceId: 'workspace-1',
        roomId: 'debate',
        runId: 'rpc-unfinished-run-1',
      })

      await waitForRunJobAuditRecords(workspaceRoot, (records) => records.some((record) => (
        record.job.runId === 'rpc-unfinished-run-1' && record.job.state === 'running'
      )))

      const restarted = await createHarness(createDeps())
      const listed = await restarted.listRunJobs(restarted.ctx, {
        workspaceId: 'workspace-1',
        roomId: 'debate',
      }) as {
        jobs: Array<{
          runId: string
          state: string
          recovered?: boolean
          recovery?: { code: string; source: string; previousState: string; recoveredAt: string }
          failure?: { code?: string; message: string }
        }>
      }

      expect(listed.jobs).toHaveLength(1)
      expect(listed.jobs[0]).toMatchObject({
        runId: 'rpc-unfinished-run-1',
        state: 'failed',
        recovered: true,
        recovery: {
          code: 'recovered_without_executor',
          source: 'run-jobs.jsonl',
          previousState: 'running',
        },
        failure: {
          code: 'recovered_without_executor',
        },
      })

      const waited = await restarted.waitRunJob(restarted.ctx, {
        workspaceId: 'workspace-1',
        runId: 'rpc-unfinished-run-1',
        timeoutMs: 10,
      }) as { job: { runId: string; state: string; failure?: { code?: string } } }
      expect(waited.job).toMatchObject({
        runId: 'rpc-unfinished-run-1',
        state: 'failed',
        failure: {
          code: 'recovered_without_executor',
        },
      })

      const got = await restarted.getRunJob(restarted.ctx, {
        workspaceId: 'workspace-1',
        runId: 'rpc-unfinished-run-1',
      }) as { job?: { recovered?: boolean; recovery?: { recoveredAt: string } } }
      expect(got.job?.recovered).toBe(true)
      expect(got.job?.recovery?.recoveredAt).toBe(listed.jobs[0]!.recovery?.recoveredAt)

      const records = await waitForRunJobAuditRecords(workspaceRoot, (auditRecords) => auditRecords.some((record) => (
        record.reason === 'recovery' && record.job.runId === 'rpc-unfinished-run-1'
      )))
      expect(records.at(-1)?.job.state).toBe('failed')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('restarts unfinished run jobs through RPC handlers when an executor is configured after restart', async () => {
    try {
      const first = await createHarness(createDeps({
        skillMomentRunCycleExecutor: async () => await new Promise<never>(() => {}),
      }))

      await first.runCycle(first.ctx, {
        workspaceId: 'workspace-1',
        roomId: 'debate',
        runId: 'rpc-restartable-run-1',
      })

      await waitForRunJobAuditRecords(workspaceRoot, (records) => records.some((record) => (
        record.job.runId === 'rpc-restartable-run-1' && record.job.state === 'running'
      )))

      const restarted = await createHarness(createDeps({
        skillMomentRunCycleExecutor: async (input, emitStatus) => {
          emitStatus({
            workspaceId: input.workspaceId,
            roomId: input.roomId || 'debate',
            runId: input.runId,
            phase: 'writing',
            message: 'restarted through rpc',
            createdAt: new Date().toISOString(),
          })
          return {
            success: true,
            runId: input.runId!,
            moments: [],
            sourceDigests: [],
            path: workspaceRoot,
          }
        },
      }))

      const listed = await restarted.listRunJobs(restarted.ctx, {
        workspaceId: 'workspace-1',
        roomId: 'debate',
      }) as {
        jobs: Array<{
          runId: string
          recovered?: boolean
          recovery?: { code: string; previousState: string }
        }>
      }
      expect(listed.jobs).toHaveLength(1)
      expect(listed.jobs[0]).toMatchObject({
        runId: 'rpc-restartable-run-1',
        recovered: true,
        recovery: {
          code: 'restarted_from_audit',
          previousState: 'running',
        },
      })

      const waited = await restarted.waitRunJob(restarted.ctx, {
        workspaceId: 'workspace-1',
        runId: 'rpc-restartable-run-1',
        timeoutMs: 1_000,
      }) as {
        job: {
          runId: string
          state: string
          recovered?: boolean
          recovery?: { code: string }
          events: Array<{ phase: string; message: string }>
        }
      }
      expect(waited.job).toMatchObject({
        runId: 'rpc-restartable-run-1',
        state: 'succeeded',
        recovered: true,
        recovery: {
          code: 'restarted_from_audit',
        },
      })
      expect(waited.job.events.some((event) => event.message === 'restarted through rpc')).toBe(true)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('fails fast when no run-cycle executor is configured', async () => {
    try {
      const { runCycle, ctx } = await createHarness(createDeps())

      await expect(runCycle(ctx, {
        workspaceId: 'workspace-1',
        roomId: 'debate',
      })).rejects.toThrow('executor is not configured')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('passes the complete stage control input to the run-cycle executor', async () => {
    try {
      const stageControl = {
        schemaVersion: 1,
        stageId: 'stage-1',
        controlLevel: 'human_guided',
        sceneType: 'edict_council',
        directorCommand: '祖国人先发难，Butcher 只用一句话回击。',
        activeCast: ['homelander', 'butcher', 'starlight'],
        speakerOrder: ['homelander', 'butcher'],
        conflictTarget: 'public loyalty test',
        mediaPolicy: 'allow_actor_requested_images',
        humanGate: 'before_persist',
        maxMoments: 2,
        maxCriticsPerMoment: 1,
      } as const
      let receivedInput: unknown
      let resolveReceived: () => void = () => {}
      const received = new Promise<void>((resolve) => {
        resolveReceived = resolve
      })
      const { runCycle, ctx } = await createHarness(createDeps({
        skillMomentRunCycleExecutor: async (input) => {
          receivedInput = input
          resolveReceived()
          return {
            success: true,
            runId: input.runId!,
            moments: [],
            sourceDigests: [],
            path: workspaceRoot,
          }
        },
      }))

      const result = await runCycle(ctx, {
        workspaceId: 'workspace-1',
        roomId: 'stage-room',
        runId: 'stage-run-1',
        mode: 'real',
        stageControl,
        skillSlugs: ['homelander', 'butcher'],
        skills: [
          { id: 'homelander', name: '祖国人', handle: '@homelander' },
          { id: 'butcher', name: 'Butcher', handle: '@butcher' },
        ],
        workingDirectory: '/workspace/story-room',
        maxMoments: 8,
        maxCriticsPerMoment: 4,
      })
      await received

      expect(result).toMatchObject({
        success: true,
        runId: 'stage-run-1',
        state: 'started',
      })
      expect(receivedInput).toEqual({
        workspaceId: 'workspace-1',
        roomId: 'stage-room',
        runId: 'stage-run-1',
        mode: 'real',
        stageControl,
        skillSlugs: ['homelander', 'butcher'],
        skills: [
          { id: 'homelander', name: '祖国人', handle: '@homelander' },
          { id: 'butcher', name: 'Butcher', handle: '@butcher' },
        ],
        workingDirectory: '/workspace/story-room',
        maxMoments: 8,
        maxCriticsPerMoment: 4,
      })
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('lists and reviews evolution candidates through RPC handlers', async () => {
    try {
      const {
        ctx,
        recordFeedback,
        listEvolutionCandidates,
        reviewEvolutionCandidate,
      } = await createHarness(createDeps())

      await recordFeedback(ctx, {
        workspaceId: 'workspace-1',
        roomId: 'debate',
        momentId: 'moment-1',
        skillId: 'homelander',
        skillName: '祖国人',
        handle: '@homelander',
        verdict: 1,
        messageBody: '把城市大屏变成公开审判，逼 Butcher 到镜头前。',
        recordedAt: '2026-06-04T00:00:00.000Z',
      })

      const pending = await listEvolutionCandidates(ctx, {
        workspaceId: 'workspace-1',
        reviewState: 'pending',
      }) as { candidates: Array<{ candidateId: string; status: string; target: { momentId: string } }> }
      expect(pending.candidates).toHaveLength(1)
      expect(pending.candidates[0]!.status).toBe('pending_review')
      expect(pending.candidates[0]!.target.momentId).toBe('moment-1')

      const reviewResult = await reviewEvolutionCandidate(ctx, {
        workspaceId: 'workspace-1',
        candidateId: pending.candidates[0]!.candidateId,
        status: 'accepted',
        reviewedAt: '2026-06-04T00:01:00.000Z',
        reviewedBy: { id: 'reviewer-1', name: 'Reviewer One' },
      }) as { candidate: { status: string; reviewedBy?: { id?: string } } }
      expect(reviewResult.candidate.status).toBe('accepted')
      expect(reviewResult.candidate.reviewedBy?.id).toBe('reviewer-1')

      const pendingAfterReview = await listEvolutionCandidates(ctx, {
        workspaceId: 'workspace-1',
        reviewState: 'pending',
      }) as { candidates: unknown[] }
      const reviewed = await listEvolutionCandidates(ctx, {
        workspaceId: 'workspace-1',
        reviewState: 'reviewed',
      }) as { candidates: Array<{ status: string }> }

      expect(pendingAfterReview.candidates).toHaveLength(0)
      expect(reviewed.candidates).toHaveLength(1)
      expect(reviewed.candidates[0]!.status).toBe('accepted')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
