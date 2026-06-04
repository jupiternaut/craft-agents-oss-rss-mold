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
  }
  const { registerSkillMomentsHandlers } = await import('./skill-moments')
  registerSkillMomentsHandlers(server, deps)
  const runCycle = handlers.get(RPC_CHANNELS.skillMoments.RUN_CYCLE)
  if (!runCycle) {
    throw new Error('RUN_CYCLE handler not registered')
  }
  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: 'workspace-1',
    webContentsId: 101,
  }
  return { runCycle, ctx, pushCalls }
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
})
