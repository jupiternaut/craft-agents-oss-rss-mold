import * as React from 'react'
import { Bot, Check, ExternalLink, Heart } from 'lucide-react'

import { SkillAvatar } from '@/components/ui/skill-avatar'
import { cn } from '@/lib/utils'
import type {
  SkillFeedbackVerdict,
  SkillMoment,
} from '../../../../shared/types'
import { MomentCritiqueRow } from './MomentCritiqueRow'
import type {
  SkillMomentFeedbackTarget,
  SkillMomentRole,
} from './types'
import {
  feedbackTargetKey,
  skillMomentFeedbackOptions,
} from './types'
import {
  formatArtifactBadge,
  isWriterArtifactTag,
} from './artifact-badges'

type MomentCardProps = {
  workspaceId?: string
  moment: SkillMoment
  roles: SkillMomentRole[]
  pendingFeedbackKey?: string
  onFeedback: (target: SkillMomentFeedbackTarget, verdict: SkillFeedbackVerdict) => void
}

function mediaImageSrc(path: string): string {
  return `thumbnail://thumb/${encodeURIComponent(path)}`
}

export function MomentCard({
  workspaceId,
  moment,
  roles,
  pendingFeedbackKey,
  onFeedback,
}: MomentCardProps) {
  const role = roles.find((candidate) => candidate.id === moment.skillId)
  const momentTarget: SkillMomentFeedbackTarget = { kind: 'moment', moment }
  const momentTargetKey = feedbackTargetKey(momentTarget)

  return (
    <article className="flex gap-4 border-b border-border/60 py-5 last:border-b-0">
      {role?.skill ? (
        <SkillAvatar skill={role.skill} size="md" className="h-10 w-10 shrink-0" workspaceId={workspaceId} />
      ) : (
        <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-foreground/[0.06] text-muted-foreground">
          <Bot className="size-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">{moment.skillName}</span>
          <span className="text-xs text-muted-foreground">{moment.handle}</span>
          <span className="text-[11px] text-muted-foreground">
            {new Date(moment.createdAt).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span className="rounded-[5px] bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {moment.confidence}
          </span>
        </div>

        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
          {moment.body}
        </div>

        {moment.media?.length ? (
          <div className="mt-3 grid max-w-[420px] gap-2">
            {moment.media.map((media) => (
              <img
                key={media.id}
                src={mediaImageSrc(media.path)}
                alt={media.alt || 'Skill Moment media'}
                className="w-full rounded-[8px] border border-border/60 object-cover"
                loading="lazy"
              />
            ))}
          </div>
        ) : null}

        {moment.sources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {moment.sources.map((source) => (
              <a
                key={source.id}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 rounded-[6px] border border-border/60 bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                title={source.summary}
              >
                <span className="truncate">{source.source}: {source.title}</span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
            ))}
          </div>
        )}

        {moment.artifacts && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {moment.artifacts.map((artifact) => (
              <span
                key={artifact}
                className={cn(
                  'rounded-[5px] bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-muted-foreground',
                  isWriterArtifactTag(artifact) && 'border border-foreground/15 bg-background text-foreground',
                )}
              >
                {formatArtifactBadge(artifact)}
              </span>
            ))}
          </div>
        )}

        {moment.reactions?.length ? (
          <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-[6px] bg-rose-500/10 px-2 py-1 text-[11px] text-rose-700 dark:text-rose-300">
            <Heart className="size-3 fill-current" />
            <span className="truncate">
              {moment.reactions.map((reaction) => reaction.skillName || reaction.handle).join('、')} 点赞
            </span>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="mr-0.5">本次表现</span>
          {skillMomentFeedbackOptions.map((option) => {
            const selected = moment.feedbackVerdict === option.verdict
            return (
              <button
                key={option.verdict}
                type="button"
                disabled={pendingFeedbackKey === momentTargetKey}
                onClick={() => onFeedback(momentTarget, option.verdict)}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-[5px] border px-2 transition-colors disabled:cursor-wait disabled:opacity-60',
                  selected
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border/50 bg-background hover:bg-foreground/[0.04] hover:text-foreground',
                )}
                title={selected && moment.feedbackSavedPath ? `已记录到 ${moment.feedbackSavedPath}` : '记录这次朋友圈体验'}
              >
                {selected ? <Check className="size-3" /> : null}
                {option.label}
              </button>
            )
          })}
        </div>

        {moment.critiques.length > 0 && (
          <div className="mt-3 space-y-2">
            {moment.critiques.map((critique) => (
              <MomentCritiqueRow
                key={critique.id}
                workspaceId={workspaceId}
                target={{ kind: 'critique', moment, critique }}
                roles={roles}
                pendingFeedbackKey={pendingFeedbackKey}
                onFeedback={onFeedback}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  )
}
