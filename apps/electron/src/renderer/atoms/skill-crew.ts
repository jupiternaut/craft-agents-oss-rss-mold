import { atom } from 'jotai'

export type SkillCrewChannelId = string

export const DEFAULT_SKILL_CREW_ROOMS = ['debate', 'design', 'build', 'policy'] as const

export const skillCrewChannelAtom = atom<SkillCrewChannelId>('debate')
