import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type {
  SkillMomentFeedbackRecordInput,
  SkillMomentListInput,
  SkillMomentRunCycleInput,
} from '@craft-agent/shared/skill-moments'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'

import type { RpcServer } from '../../transport'
import { pushTyped } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import {
  listSkillMomentsForWorkspace,
  recordSkillMomentFeedbackForWorkspace,
  SkillMomentRunJobManager,
} from '../../skill-moments'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skillMoments.LIST,
  RPC_CHANNELS.skillMoments.RUN_CYCLE,
  RPC_CHANNELS.skillMoments.RECORD_FEEDBACK,
] as const

export function registerSkillMomentsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const runJobs = new SkillMomentRunJobManager()

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

  server.handle(RPC_CHANNELS.skillMoments.RECORD_FEEDBACK, async (_ctx, args: SkillMomentFeedbackRecordInput) => {
    const workspace = getWorkspaceByNameOrId(args.workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`)
    }

    return await recordSkillMomentFeedbackForWorkspace(workspace.rootPath, args)
  })
}
