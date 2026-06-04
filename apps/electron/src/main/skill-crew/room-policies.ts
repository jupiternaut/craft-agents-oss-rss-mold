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

const REACTION_ONLY_DEBATE_SKILL_SLUGS = new Set([
  'ashley',
  'atrain',
  'black-noir',
  'deep',
])

const HOMELANDER_THEATER_CRITIC_SLUGS = new Set([
  'ashley',
  'atrain',
  'black-noir',
  'deep',
  'starlight',
  'butcher',
  'chomsky',
  'hayek',
  'sun',
  'gazi',
  'dongbei-yujie',
  'liu-haizhu',
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

const SKILL_MOMENT_SLUG_ALIASES = new Map([
  ['祖国人', 'homelander'],
  ['屠夫', 'butcher'],
  ['火车头', 'atrain'],
  ['玄色', 'black-noir'],
  ['深海', 'deep'],
  ['碍事丽', 'ashley'],
  ['星光', 'starlight'],
  ['东北雨姐', 'dongbei-yujie'],
  ['雨姐', 'dongbei-yujie'],
  ['嘎子', 'gazi'],
  ['嘎子哥', 'gazi'],
  ['刘海柱', 'liu-haizhu'],
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
  const trimmed = raw.trim()
  return SKILL_MOMENT_SLUG_ALIASES.get(trimmed) ?? trimmed.toLocaleLowerCase()
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
  if (REACTION_ONLY_DEBATE_SKILL_SLUGS.has(authorSlug)) {
    return false
  }

  if (authorSlug === 'homelander') {
    if (text.includes('我复活了') || text.includes('我回来了')) {
      return false
    }

    return (
      (
        /直播|大屏|倒计时|投票|镜头|门|证人|名单|转发|民调|媒体|前排|塔楼|评论区|集会|记者|市政厅|天台|城市|照片/.test(text)
        && /Butcher|屠夫|Vought|叛徒|证据|选择|认错|下跪|假新闻|输家|敌人/.test(text)
      )
      || (
        /密道|画像|披风|热狗|三美元|硬币|旧粉丝|手机|海报|垃圾|审判|符号|新英雄|假证|诊所|欠条|医生|白宫|证件|救济|仓库|化合物/.test(text)
        && /信仰|报价|旧货|听话|神|普通|害怕|低头|身体|疼|威胁|忠诚|直播|替代|权力|燃烧/.test(text)
      )
    )
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

  const authorSlug = normalizeSkillMomentSlug(author)
  const criticSlug = normalizeSkillMomentSlug(critic)

  const chars = Array.from(text).length
  if (authorSlug === 'homelander' && HOMELANDER_THEATER_CRITIC_SLUGS.has(criticSlug)) {
    return chars >= 4 && chars <= 120
  }
  if (authorSlug === 'homelander' && criticSlug === 'homelander') {
    return chars >= 4 && chars <= 120
  }
  if (authorSlug === 'butcher' && criticSlug === 'homelander') {
    return chars >= 4 && chars <= 120
  }
  if (criticSlug === 'homelander') {
    return chars >= 4 && chars <= 120
  }
  if (criticSlug === 'butcher') {
    return chars >= 4 && chars <= 120
  }

  if (chars < 5 || chars > 20) {
    return false
  }

  if (authorSlug === 'homelander' && criticSlug === 'butcher') {
    return true
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
