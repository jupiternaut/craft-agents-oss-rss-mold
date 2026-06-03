import type {
  LoadedSkill,
  SkillMoment,
  SkillMomentCritique,
  SkillFeedbackVerdict,
} from '../../../../shared/types'

export type SkillMomentRole = {
  id: string
  name: string
  handle: string
  description: string
  skill?: LoadedSkill
  chairman?: boolean
  global?: boolean
}

export type SkillMomentFeedbackTarget =
  | { kind: 'moment'; moment: SkillMoment }
  | { kind: 'critique'; moment: SkillMoment; critique: SkillMomentCritique }

export type SkillMomentFeedbackOption = {
  verdict: SkillFeedbackVerdict
  label: string
}

export const skillMomentFeedbackOptions: SkillMomentFeedbackOption[] = [
  { verdict: 1, label: '1 进化' },
  { verdict: 2, label: '2 不变' },
  { verdict: 3, label: '3 退化' },
]

export function feedbackTargetKey(target: SkillMomentFeedbackTarget): string {
  return target.kind === 'critique'
    ? `${target.moment.id}:${target.critique.id}`
    : target.moment.id
}
