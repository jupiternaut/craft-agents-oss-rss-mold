import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'

let workspaceRoot = ''

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
  return { runCycle, recordFeedback, listEvolutionCandidates, reviewEvolutionCandidate, ctx, pushCalls }
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
