import { atom } from 'jotai'
import type { LoadedSkill } from '../../shared/types'

export type SkillCrewChannelId = string
export type SkillCrewPlacement = Record<string, string>

export const DEFAULT_SKILL_CREW_ROOMS = ['debate', 'design', 'build', 'policy'] as const

export const skillCrewChannelAtom = atom<SkillCrewChannelId>('debate')
export const skillCrewPlacementAtom = atom<SkillCrewPlacement>({})

export function inferSkillCrewRoomId(skill: LoadedSkill): SkillCrewChannelId {
  const haystack = `${skill.slug} ${skill.path} ${skill.metadata.name ?? ''} ${skill.metadata.description ?? ''}`.toLowerCase()

  if (/(design|frontend|css|gsap|anime|lottie|three|hyperframes|ui|visual)/.test(haystack)) {
    return 'design'
  }

  if (/(decision|muzero|kant|abductive|hermeneutic|skillcreator|debate|reason)/.test(haystack)) {
    return 'debate'
  }

  if (/(lark|policy|approval|okr|calendar|mail|slack|doc|sheet|wiki)/.test(haystack)) {
    return 'policy'
  }

  return 'build'
}

export function inferSkillPhysicalFolderId(skill: LoadedSkill, folderIds: string[]): string | null {
  const sortedFolderIds = folderIds
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  for (const folderId of sortedFolderIds) {
    if (skill.path.endsWith(`/skills/${folderId}/${skill.slug}`)) {
      return folderId
    }
  }

  return null
}
