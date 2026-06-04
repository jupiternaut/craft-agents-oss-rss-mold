import scenePackJson from './scene-pack.json'

export type HomelanderFallenGodPostTemplate = {
  id: string
  visibility: string
  body: string
}

export type HomelanderFallenGodMediaPrompt = {
  id: string
  theme: string
  alt: string
  prompt: string
}

export type HomelanderFallenGodBeat = {
  id: string
  order: number
  status: string
  title: string
  tags: string[]
  coreConflict: string
  visualAnchor: string
  homelanderState: string
  postTemplates: HomelanderFallenGodPostTemplate[]
  mediaPrompts: HomelanderFallenGodMediaPrompt[]
}

export type HomelanderFallenGodCriticProfile = {
  skillSlug: string
  displayName: string
  role: string
  weight: number
  bestForTags: string[]
}

export type HomelanderFallenGodScenePack = {
  schemaVersion: 1
  kind: 'skill_moments_scene_pack'
  id: 'homelander-fallen-god'
  title: string
  status: string
  globalDirectives: {
    randomization: {
      momentCountRange: { min: number; max: number }
      critiqueCountRange: { min: number; max: number }
      allowSilentCritics: boolean
    }
  }
  participants: {
    randomCriticPool: HomelanderFallenGodCriticProfile[]
    excludedAutoParticipants: Array<{ skillSlug: string; reason: string }>
  }
  commentPools: Record<string, string[]>
  beats: HomelanderFallenGodBeat[]
}

export type HomelanderFallenGodMomentSelection = {
  scenePackId: 'homelander-fallen-god'
  beat: HomelanderFallenGodBeat
  template: HomelanderFallenGodPostTemplate
  mediaPrompt?: HomelanderFallenGodMediaPrompt
  artifacts: string[]
}

export const HOMELANDER_FALLEN_GOD_SCENE_PACK_ID = 'homelander-fallen-god' as const

const scenePack = scenePackJson as HomelanderFallenGodScenePack

function seededRatio(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0xffffffff
}

function seededInt(seed: string, min: number, max: number): number {
  if (max <= min) {
    return min
  }
  return min + Math.floor(seededRatio(seed) * (max - min + 1))
}

function seededPick<T>(items: T[], seed: string): T | undefined {
  if (items.length === 0) {
    return undefined
  }
  return items[seededInt(seed, 0, items.length - 1)]
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  return items
    .map((item, index) => ({
      item,
      rank: seededRatio(`${seed}:${index}`),
    }))
    .sort((left, right) => left.rank - right.rank)
    .map(({ item }) => item)
}

function weightedCriticProfiles(seed: string): HomelanderFallenGodCriticProfile[] {
  const expanded = scenePack.participants.randomCriticPool.flatMap((profile) => (
    Array.from({ length: Math.max(1, profile.weight) }, () => profile)
  ))
  const unique = new Set<string>()
  const picked: HomelanderFallenGodCriticProfile[] = []
  for (const profile of seededShuffle(expanded, seed)) {
    if (!unique.has(profile.skillSlug)) {
      unique.add(profile.skillSlug)
      picked.push(profile)
    }
  }
  return picked
}

export function getHomelanderFallenGodScenePack(): HomelanderFallenGodScenePack {
  return scenePack
}

export function isHomelanderFallenGodExcludedParticipant(skillSlug: string): boolean {
  return scenePack.participants.excludedAutoParticipants.some((participant) => participant.skillSlug === skillSlug)
}

export function selectHomelanderFallenGodMoment(seed: string, index: number): HomelanderFallenGodMomentSelection {
  const orderedBeats = [...scenePack.beats].sort((left, right) => left.order - right.order)
  const beats = seededShuffle(orderedBeats, `${seed}:beats`)
  const beat = beats[index % beats.length] ?? orderedBeats[0]!
  const template = seededPick(beat.postTemplates, `${seed}:${beat.id}:post`) ?? beat.postTemplates[0]!
  const mediaPrompt = seededPick(beat.mediaPrompts, `${seed}:${beat.id}:media`)
  const artifacts = [
    `scene_pack:${scenePack.id}`,
    `beat:${beat.id}`,
    ...beat.tags.map((tag) => `beat_tag:${tag}`),
    'persona_scene_moment',
  ]

  return {
    scenePackId: scenePack.id,
    beat,
    template,
    mediaPrompt,
    artifacts,
  }
}

export function selectHomelanderFallenGodCriticSlugs(args: {
  availableSlugs: string[]
  beat: HomelanderFallenGodBeat
  seed: string
  maxCritics: number
}): string[] {
  const maxCritics = Math.max(0, args.maxCritics)
  if (maxCritics === 0) {
    return []
  }

  const range = scenePack.globalDirectives.randomization.critiqueCountRange
  const count = Math.min(
    maxCritics,
    seededInt(args.seed, Math.max(0, range.min), Math.max(range.min, range.max)),
  )
  if (count === 0) {
    return []
  }

  const available = new Set(args.availableSlugs)
  const relevant = weightedCriticProfiles(`${args.seed}:weighted`)
    .filter((profile) => available.has(profile.skillSlug))
    .sort((left, right) => {
      const leftMatch = left.bestForTags.some((tag) => args.beat.tags.includes(tag)) ? 0 : 1
      const rightMatch = right.bestForTags.some((tag) => args.beat.tags.includes(tag)) ? 0 : 1
      if (leftMatch !== rightMatch) {
        return leftMatch - rightMatch
      }
      return 0
    })

  return relevant.slice(0, count).map((profile) => profile.skillSlug)
}

export function pickHomelanderFallenGodCritiqueBody(skillSlug: string, seed: string): string | undefined {
  const pool = scenePack.commentPools[skillSlug]
  return pool ? seededPick(pool, seed) : undefined
}

