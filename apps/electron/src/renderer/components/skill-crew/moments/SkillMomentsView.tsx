import * as React from 'react'
import { Loader2, MessageCircle } from 'lucide-react'

import type {
  SkillFeedbackVerdict,
  SkillMoment,
  SkillMomentStageControl,
} from '../../../../shared/types'
import { AgentOSControlBar } from './AgentOSControlBar'
import { MomentCard } from './MomentCard'
import type {
  SkillMomentFeedbackTarget,
  SkillMomentRole,
} from './types'

type SkillMomentsViewProps = {
  mode: 'moments' | 'agentos'
  workspaceId?: string
  roomId: string
  roomLabel: string
  moments: SkillMoment[]
  roles: SkillMomentRole[]
  loading: boolean
  running: boolean
  lastRunPath?: string
  pendingFeedbackKey?: string
  onReload: () => void
  onGenerate: (stageControl?: SkillMomentStageControl) => void
  onFeedback: (target: SkillMomentFeedbackTarget, verdict: SkillFeedbackVerdict) => void
}

export function SkillMomentsView({
  mode,
  workspaceId,
  roomId,
  roomLabel,
  moments,
  roles,
  loading,
  running,
  lastRunPath,
  pendingFeedbackKey,
  onReload,
  onGenerate,
  onFeedback,
}: SkillMomentsViewProps) {
  const criticCount = React.useMemo(
    () => moments.reduce((count, moment) => count + moment.critiques.length, 0),
    [moments],
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentOSControlBar
        roomLabel={roomLabel}
        roomId={roomId}
        mode={mode}
        running={running}
        loading={loading}
        momentCount={moments.length}
        criticCount={criticCount}
        lastRunPath={lastRunPath}
        roles={roles}
        onReload={onReload}
        onGenerate={onGenerate}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-6 pb-10">
          {loading && moments.length === 0 ? (
            <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              loading moments
            </div>
          ) : null}

          {!loading && moments.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center text-muted-foreground">
              <div className="grid size-10 place-items-center rounded-[8px] bg-foreground/[0.06]">
                <MessageCircle className="size-5" />
              </div>
              <div className="mt-3 text-sm font-medium text-foreground">暂无朋友圈</div>
              <div className="mt-1 text-xs">生成一轮会启动 AgentOS；刷新列表只读取已保存内容。</div>
            </div>
          ) : null}

          {moments.length > 0 ? (
            <div className="divide-y-0">
              {moments.map((moment) => (
                <MomentCard
                  key={moment.id}
                  workspaceId={workspaceId}
                  moment={moment}
                  roles={roles}
                  pendingFeedbackKey={pendingFeedbackKey}
                  onFeedback={onFeedback}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export type { SkillMomentFeedbackTarget, SkillMomentRole } from './types'
