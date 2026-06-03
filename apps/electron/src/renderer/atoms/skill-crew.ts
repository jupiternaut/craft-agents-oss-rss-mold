import { atom } from 'jotai'
import type { LoadedSkill } from '../../shared/types'

export type SkillCrewChannelId = string
export type SkillCrewPlacement = Record<string, string>

export const DEFAULT_SKILL_CREW_ROOMS = ['debate', 'design', 'build', 'policy', 'screenplay'] as const
export const GLOBAL_SKILL_CREW_ROOM = '0skill'

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

  if (/(screenplay|screenwriter|showrunner|script|fountain|dialogue|scene|character|continuity|rewrite)/.test(haystack)) {
    return 'screenplay'
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

export function isGlobalSkillCrewSkill(skill: LoadedSkill): boolean {
  return skill.path.includes(`/skills/${GLOBAL_SKILL_CREW_ROOM}/${skill.slug}`)
}
