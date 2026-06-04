import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type {
  SkillMomentEvolutionCandidateListInput,
  SkillMomentEvolutionCandidateReviewInput,
  SkillMomentFeedbackRecordInput,
  SkillMomentListInput,
  SkillMomentRunCycleInput,
  SkillMomentRunJobGetInput,
  SkillMomentRunJobListInput,
  SkillMomentRunJobWaitInput,
} from '@craft-agent/shared/skill-moments'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'

import type { RpcServer } from '../../transport'
import { pushTyped } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import {
  listSkillMomentEvolutionCandidatesForWorkspace,
  listSkillMomentsForWorkspace,
  markSkillMomentEvolutionCandidateReviewedForWorkspace,
  recordSkillMomentFeedbackForWorkspace,
  SkillMomentRunJobManager,
} from '../../skill-moments'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skillMoments.LIST,
  RPC_CHANNELS.skillMoments.RUN_CYCLE,
  RPC_CHANNELS.skillMoments.GET_RUN_JOB,
  RPC_CHANNELS.skillMoments.LIST_RUN_JOBS,
  RPC_CHANNELS.skillMoments.WAIT_RUN_JOB,
  RPC_CHANNELS.skillMoments.RECORD_FEEDBACK,
  RPC_CHANNELS.skillMoments.LIST_EVOLUTION_CANDIDATES,
  RPC_CHANNELS.skillMoments.REVIEW_EVOLUTION_CANDIDATE,
] as const

export function registerSkillMomentsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const runJobs = new SkillMomentRunJobManager({
    recoveryExecutor: deps.skillMomentRunCycleExecutor,
    recoveryMode: deps.skillMomentRunCycleExecutor ? 'restart' : 'fail',
    emitRecoveredStatus: (event) => {
      deps.platform.logger.info('[skill-moments] recovered run-cycle job status', {
        workspaceId: event.workspaceId,
        roomId: event.roomId,
        runId: event.runId,
        phase: event.phase,
      })
    },
  })

  server.handle(RPC_CHANNELS.skillMoments.LIST, async (_ctx, args: SkillMomentListInput) => {
    const workspace = getWorkspaceByNameOrId(args.workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`)
    }

    return await listSkillMomentsForWorkspace(workspace.rootPath, {
      roomId: args.roomId,
      limit: args.limit,
    })
  })

  server.handle(RPC_CHANNELS.skillMoments.RUN_CYCLE, async (ctx, args: SkillMomentRunCycleInput) => {
    const workspace = getWorkspaceByNameOrId(args.workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`)
    }
    if (!deps.skillMomentRunCycleExecutor) {
      deps.platform.logger.warn('[skill-moments] run-cycle executor is not configured for this host', {
        workspaceId: args.workspaceId,
        roomId: args.roomId,
      })
      throw new Error('Skill Moments run-cycle executor is not configured for this host.')
    }

    deps.platform.logger.info('[skill-moments] starting async run-cycle job', {
      workspaceId: args.workspaceId,
      roomId: args.roomId,
    })
    return runJobs.startRun({
      rootPath: workspace.rootPath,
      input: args,
      executor: deps.skillMomentRunCycleExecutor,
      emitStatus: (event) => {
        pushTyped(server, RPC_CHANNELS.skillMoments.RUN_STATUS, { to: 'client', clientId: ctx.clientId }, event)
      },
    })
  })

  server.handle(RPC_CHANNELS.skillMoments.GET_RUN_JOB, async (_ctx, args: SkillMomentRunJobGetInput) => {
    const workspace = getWorkspaceByNameOrId(args.workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`)
    }

    return {
      job: await runJobs.getRunAudit({
        rootPath: workspace.rootPath,
        workspaceId: args.workspaceId,
        runId: args.runId,
      }),
    }
  })

  server.handle(RPC_CHANNELS.skillMoments.LIST_RUN_JOBS, async (_ctx, args: SkillMomentRunJobListInput) => {
    const workspace = getWorkspaceByNameOrId(args.workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`)
    }

    return {
      jobs: await runJobs.listRunAudits({
        rootPath: workspace.rootPath,
        workspaceId: args.workspaceId,
        roomId: args.roomId,
        limit: args.limit,
      }),
    }
  })

  server.handle(RPC_CHANNELS.skillMoments.WAIT_RUN_JOB, async (_ctx, args: SkillMomentRunJobWaitInput) => {
    const workspace = getWorkspaceByNameOrId(args.workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`)
    }

    return {
      job: await runJobs.waitForRunAudit({
        rootPath: workspace.rootPath,
        workspaceId: args.workspaceId,
        runId: args.runId,
        timeoutMs: args.timeoutMs,
      }),
    }
  })

  server.handle(RPC_CHANNELS.skillMoments.RECORD_FEEDBACK, async (_ctx, args: SkillMomentFeedbackRecordInput) => {
    const workspace = getWorkspaceByNameOrId(args.workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`)
    }

    return await recordSkillMomentFeedbackForWorkspace(workspace.rootPath, args)
  })

  server.handle(
    RPC_CHANNELS.skillMoments.LIST_EVOLUTION_CANDIDATES,
    async (_ctx, args: SkillMomentEvolutionCandidateListInput) => {
      const workspace = getWorkspaceByNameOrId(args.workspaceId)
      if (!workspace) {
        throw new Error(`Workspace not found: ${args.workspaceId}`)
      }

      return await listSkillMomentEvolutionCandidatesForWorkspace(workspace.rootPath, args)
    },
  )

  server.handle(
    RPC_CHANNELS.skillMoments.REVIEW_EVOLUTION_CANDIDATE,
    async (_ctx, args: SkillMomentEvolutionCandidateReviewInput) => {
      const workspace = getWorkspaceByNameOrId(args.workspaceId)
      if (!workspace) {
        throw new Error(`Workspace not found: ${args.workspaceId}`)
      }

      return await markSkillMomentEvolutionCandidateReviewedForWorkspace(workspace.rootPath, args)
    },
  )
}
