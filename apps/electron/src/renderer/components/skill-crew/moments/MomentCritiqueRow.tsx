import * as React from 'react'
import { Bot, Check } from 'lucide-react'

import { SkillAvatar } from '@/components/ui/skill-avatar'
import { cn } from '@/lib/utils'
import type { SkillFeedbackVerdict } from '../../../../shared/types'
import type {
  SkillMomentFeedbackTarget,
  SkillMomentRole,
} from './types'
import {
  feedbackTargetKey,
  skillMomentFeedbackOptions,
} from './types'

type MomentCritiqueRowProps = {
  target: Extract<SkillMomentFeedbackTarget, { kind: 'critique' }>
  roles: SkillMomentRole[]
  pendingFeedbackKey?: string
  onFeedback: (target: SkillMomentFeedbackTarget, verdict: SkillFeedbackVerdict) => void
}

export function MomentCritiqueRow({
  target,
  roles,
  pendingFeedbackKey,
  onFeedback,
}: MomentCritiqueRowProps) {
  const { critique } = target
  const role = roles.find((candidate) => candidate.id === critique.criticSkillId)
  const targetKey = feedbackTargetKey(target)

  return (
    <div className="flex gap-2 rounded-[7px] bg-foreground/[0.035] px-2 py-2">
      {role?.skill ? (
        <SkillAvatar skill={role.skill} size="sm" className="shrink-0" />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-foreground/[0.06] text-muted-foreground">
          <Bot className="size-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-xs font-semibold text-foreground">{critique.criticSkillName}</span>
          <span className="text-[11px] text-muted-foreground">{critique.criticHandle}</span>
          <span className="text-[11px] text-muted-foreground">
            {new Date(critique.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="mt-0.5 text-sm leading-5 text-foreground/90">{critique.body}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {skillMomentFeedbackOptions.map((option) => {
            const selected = critique.feedbackVerdict === option.verdict
            return (
              <button
                key={option.verdict}
                type="button"
                disabled={pendingFeedbackKey === targetKey}
                onClick={() => onFeedback(target, option.verdict)}
                className={cn(
                  'inline-flex h-5 items-center gap-1 rounded-[5px] border px-1.5 transition-colors disabled:cursor-wait disabled:opacity-60',
                  selected
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border/50 bg-background hover:bg-foreground/[0.04] hover:text-foreground',
                )}
                title={selected && critique.feedbackSavedPath ? `已记录到 ${critique.feedbackSavedPath}` : '记录这次锐评体验'}
              >
                {selected ? <Check className="size-3" /> : null}
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
