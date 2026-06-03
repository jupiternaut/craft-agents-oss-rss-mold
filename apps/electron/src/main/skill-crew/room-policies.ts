import { WRITER_ROOM_ID, type WriterArtifactKind } from '@craft-agent/shared/writer-room'

import type { SkillMomentSkillInput } from '../../shared/types'

type CriticOrderContext = {
  artifactKind?: WriterArtifactKind
}

export type SkillCrewRoomPolicy = {
  roomId: string
  shouldAutoInclude(skill: SkillMomentSkillInput): boolean
  orderParticipants(skills: SkillMomentSkillInput[]): SkillMomentSkillInput[]
  orderCritics(author: SkillMomentSkillInput, critics: SkillMomentSkillInput[], context?: CriticOrderContext): SkillMomentSkillInput[]
  shouldKeepMoment(author: SkillMomentSkillInput, body: string): boolean
  shouldKeepCritique(author: SkillMomentSkillInput, critic: SkillMomentSkillInput, body: string): boolean
}

const AUTO_MOMENT_EXCLUDED_SKILL_SLUGS = new Set([
  'skillcreator',
  'chairman',
  '__chairman__',
  'hafuke',
])

const WRITER_ROOM_PREFERRED_SKILL_SLUGS = [
  'showrunner',
  'screenwriter',
  'character',
  'scene',
  'dialogue',
  'continuity',
  'rewrite',
  'fountain',
] as const

const STRUCTURAL_WRITER_ARTIFACTS = new Set<WriterArtifactKind>([
  'project_brief',
  'series_bible',
  'episode_outline',
  'beat_sheet',
])

const CHARACTER_WRITER_ARTIFACTS = new Set<WriterArtifactKind>([
  'character_bible',
  'dialogue_draft',
])

const SCENE_WRITER_ARTIFACTS = new Set<WriterArtifactKind>([
  'scene_card',
  'dialogue_draft',
])

function stableSkillSort(
  skills: SkillMomentSkillInput[],
  priority: (skill: SkillMomentSkillInput) => number,
): SkillMomentSkillInput[] {
  return skills
    .map((skill, index) => ({ skill, index }))
    .sort((left, right) => {
      const leftPriority = priority(left.skill)
      const rightPriority = priority(right.skill)
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority
      }
      return left.index - right.index
    })
    .map(({ skill }) => skill)
}

export function normalizeSkillMomentSlug(skill: Pick<SkillMomentSkillInput, 'id' | 'name' | 'handle'>): string {
  const raw = skill.handle?.replace(/^@/, '') || skill.id || skill.name
  return raw.trim().toLocaleLowerCase()
}

export function isSkillSilenceText(text: string): boolean {
  const normalized = text
    .trim()
    .replace(/^```(?:text|plain)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  return normalized === '<SILENCE/>' || normalized === 'SILENCE'
}

function slugMatches(slug: string, target: string): boolean {
  return slug === target || slug.includes(target)
}

function writerRoomPreferredIndex(skill: SkillMomentSkillInput): number {
  const slug = normalizeSkillMomentSlug(skill)
  const index = WRITER_ROOM_PREFERRED_SKILL_SLUGS.findIndex((target) => slugMatches(slug, target))
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

function orderDebateParticipants(skills: SkillMomentSkillInput[]): SkillMomentSkillInput[] {
  const priority = new Map([
    ['homelander', 0],
    ['butcher', 1],
  ])

  return stableSkillSort(skills, (skill) => (
    priority.get(normalizeSkillMomentSlug(skill)) ?? Number.MAX_SAFE_INTEGER
  ))
}

function orderWriterRoomParticipants(skills: SkillMomentSkillInput[]): SkillMomentSkillInput[] {
  const hasWriterSkills = skills.some((skill) => writerRoomPreferredIndex(skill) !== Number.MAX_SAFE_INTEGER)
  if (!hasWriterSkills) {
    return skills
  }

  return stableSkillSort(skills, writerRoomPreferredIndex)
}

function orderDebateCritics(author: SkillMomentSkillInput, critics: SkillMomentSkillInput[]): SkillMomentSkillInput[] {
  const authorSlug = normalizeSkillMomentSlug(author)
  const targetSlug = authorSlug === 'homelander'
    ? 'butcher'
    : authorSlug === 'butcher'
      ? 'homelander'
      : null

  if (!targetSlug) {
    return critics
  }

  return stableSkillSort(critics, (skill) => (
    normalizeSkillMomentSlug(skill) === targetSlug ? 0 : 1
  ))
}

function writerRoomCriticPriority(skill: SkillMomentSkillInput, artifactKind?: WriterArtifactKind): number {
  const slug = normalizeSkillMomentSlug(skill)

  if (artifactKind && SCENE_WRITER_ARTIFACTS.has(artifactKind) && slugMatches(slug, 'continuity')) {
    return 0
  }

  if (artifactKind && STRUCTURAL_WRITER_ARTIFACTS.has(artifactKind) && slugMatches(slug, 'showrunner')) {
    return 1
  }

  if (artifactKind && CHARACTER_WRITER_ARTIFACTS.has(artifactKind) && slugMatches(slug, 'character')) {
    return 2
  }

  if (artifactKind === 'dialogue_draft' && slugMatches(slug, 'dialogue')) {
    return 3
  }

  return 10 + writerRoomPreferredIndex(skill)
}

function orderWriterRoomCritics(
  _author: SkillMomentSkillInput,
  critics: SkillMomentSkillInput[],
  context?: CriticOrderContext,
): SkillMomentSkillInput[] {
  return stableSkillSort(critics, (skill) => writerRoomCriticPriority(skill, context?.artifactKind))
}

function shouldKeepDefaultMoment(author: SkillMomentSkillInput, body: string): boolean {
  const text = body.trim()
  if (isSkillSilenceText(text)) {
    return false
  }

  const chars = Array.from(text).length
  if (chars < 20) {
    return false
  }

  const authorSlug = normalizeSkillMomentSlug(author)
  if (authorSlug === 'homelander') {
    return text.includes('孩子们，我复活了。') && text.includes('需要')
  }

  return !text.includes('AgentOS 本地 mock') && !text.includes('这条是 AgentOS')
}

function shouldKeepDefaultCritique(
  author: SkillMomentSkillInput,
  critic: SkillMomentSkillInput,
  body: string,
): boolean {
  const text = body.trim()
  if (!text || isSkillSilenceText(text)) {
    return false
  }

  const oldGenericTemplates = new Set([
    '证据只到摘要层。',
    '缺少价格信号。',
    '因果链未证明。',
    '忽略执行成本。',
    '样本太少。',
    '反证入口不足。',
  ])
  if (oldGenericTemplates.has(text)) {
    return false
  }

  const chars = Array.from(text).length
  if (chars < 5 || chars > 20) {
    return false
  }

  const authorSlug = normalizeSkillMomentSlug(author)
  const criticSlug = normalizeSkillMomentSlug(critic)
  if (authorSlug === 'homelander' && criticSlug === 'butcher') {
    return true
  }
  if (criticSlug === 'homelander') {
    return text.includes('掌声') || text.includes('神')
  }

  return (
    text.includes('？')
    || text.includes('?')
    || text.includes('保留')
    || text.includes('证据')
    || text.includes('账')
  )
}

function shouldKeepWriterRoomCritique(
  _author: SkillMomentSkillInput,
  _critic: SkillMomentSkillInput,
  body: string,
): boolean {
  const text = body.trim()
  if (!text || isSkillSilenceText(text)) {
    return false
  }

  const chars = Array.from(text).length
  return chars >= 5 && chars <= 20
}

const defaultPolicy: SkillCrewRoomPolicy = {
  roomId: '*',
  shouldAutoInclude: (skill) => !AUTO_MOMENT_EXCLUDED_SKILL_SLUGS.has(normalizeSkillMomentSlug(skill)),
  orderParticipants: (skills) => skills,
  orderCritics: (_author, critics) => critics,
  shouldKeepMoment: shouldKeepDefaultMoment,
  shouldKeepCritique: shouldKeepDefaultCritique,
}

const debatePolicy: SkillCrewRoomPolicy = {
  ...defaultPolicy,
  roomId: 'debate',
  orderParticipants: orderDebateParticipants,
  orderCritics: orderDebateCritics,
}

const writerRoomPolicy: SkillCrewRoomPolicy = {
  ...defaultPolicy,
  roomId: WRITER_ROOM_ID,
  orderParticipants: orderWriterRoomParticipants,
  orderCritics: orderWriterRoomCritics,
  shouldKeepCritique: shouldKeepWriterRoomCritique,
}

export function getSkillCrewRoomPolicy(roomId: string): SkillCrewRoomPolicy {
  if (roomId === WRITER_ROOM_ID) {
    return writerRoomPolicy
  }

  if (roomId === 'debate') {
    return debatePolicy
  }

  return {
    ...defaultPolicy,
    roomId,
  }
}
