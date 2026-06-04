import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type {
  SkillMomentFeedbackRecordInput,
  SkillMomentListInput,
  SkillMomentRunCycleInput,
} from '@craft-agent/shared/skill-moments'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'

import type { RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import {
  listSkillMomentsForWorkspace,
  recordSkillMomentFeedbackForWorkspace,
} from '../../skill-moments'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skillMoments.LIST,
  RPC_CHANNELS.skillMoments.RUN_CYCLE,
  RPC_CHANNELS.skillMoments.RECORD_FEEDBACK,
] as const

export function registerSkillMomentsHandlers(server: RpcServer, deps: HandlerDeps): void {
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

  server.handle(RPC_CHANNELS.skillMoments.RUN_CYCLE, async (_ctx, args: SkillMomentRunCycleInput) => {
    deps.platform.logger.warn('[skill-moments] run-cycle is not available in headless server-core yet', {
      workspaceId: args.workspaceId,
      roomId: args.roomId,
    })
    throw new Error('Skill Moments run-cycle is still hosted by the Electron AgentOS runner in this refactor slice.')
  })

  server.handle(RPC_CHANNELS.skillMoments.RECORD_FEEDBACK, async (_ctx, args: SkillMomentFeedbackRecordInput) => {
    const workspace = getWorkspaceByNameOrId(args.workspaceId)
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`)
    }

    return await recordSkillMomentFeedbackForWorkspace(workspace.rootPath, args)
  })
}
