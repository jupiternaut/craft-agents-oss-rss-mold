import type { WriterArtifactKind } from '@craft-agent/shared/writer-room'

import type { SkillMomentSkillInput } from '../../shared/types'
import { normalizeSkillMomentSlug } from './room-policies'

export type WriterRoomMomentPlan = {
  author: SkillMomentSkillInput
  artifactKind: WriterArtifactKind
}

export const WRITER_ROOM_MOCK_PHASES: WriterArtifactKind[] = [
  'series_bible',
  'character_bible',
  'episode_outline',
  'scene_card',
  'dialogue_draft',
  'continuity_report',
]

const WRITER_ROOM_PHASE_AUTHOR_PREFERENCES: Record<WriterArtifactKind, string[]> = {
  project_brief: ['showrunner', 'screenwriter'],
  series_bible: ['showrunner', 'screenwriter'],
  character_bible: ['character', 'showrunner', 'screenwriter'],
  episode_outline: ['showrunner', 'screenwriter'],
  beat_sheet: ['screenwriter', 'showrunner'],
  scene_card: ['scene', 'screenwriter', 'showrunner'],
  dialogue_draft: ['dialogue', 'screenwriter', 'character'],
  continuity_report: ['continuity', 'showrunner'],
  rewrite_task: ['rewrite', 'showrunner'],
  fountain_script: ['fountain', 'screenwriter'],
}

export function writerArtifactTag(kind: WriterArtifactKind): string {
  return `writer_artifact:${kind}`
}

function skillSlugMatches(skill: SkillMomentSkillInput, target: string): boolean {
  const slug = normalizeSkillMomentSlug(skill)
  return slug === target || slug.includes(target)
}

function selectWriterRoomAuthor(
  skills: SkillMomentSkillInput[],
  fallbackSkills: SkillMomentSkillInput[],
  phase: WriterArtifactKind,
  index: number,
): SkillMomentSkillInput {
  const preferences = WRITER_ROOM_PHASE_AUTHOR_PREFERENCES[phase]
  for (const preferred of preferences) {
    const match = skills.find((skill) => skillSlugMatches(skill, preferred))
    if (match) {
      return match
    }
  }

  const fallback = skills[index % skills.length] ?? fallbackSkills[index % fallbackSkills.length]
  if (!fallback) {
    throw new Error('Writer Room mock cycle requires at least one fallback skill')
  }
  return fallback
}

export function buildWriterRoomMomentPlans(
  skills: SkillMomentSkillInput[],
  fallbackSkills: SkillMomentSkillInput[],
  maxMoments: number,
): WriterRoomMomentPlan[] {
  return WRITER_ROOM_MOCK_PHASES.slice(0, maxMoments).map((artifactKind, index) => ({
    author: selectWriterRoomAuthor(skills, fallbackSkills, artifactKind, index),
    artifactKind,
  }))
}

export function buildWriterRoomMockMomentBody(skill: SkillMomentSkillInput, phase: WriterArtifactKind): string {
  const authorLine = `${skill.handle} Writer Room`

  if (phase === 'series_bible') {
    return [
      authorLine,
      'Artifact: series_bible',
      'Title: Neon Harbor',
      'Genre: grounded sci-fi thriller',
      'Premise: A blackout exposes an illegal memory market under a coastal megacity.',
      'Tone: tense, precise, intimate under pressure.',
      'Themes: loyalty versus survival; memory as currency; power hidden inside care.',
    ].join('\n')
  }

  if (phase === 'character_bible') {
    return [
      authorLine,
      'Artifact: character_bible',
      'Character: Mara Qin',
      'Desire: recover her brother before the city rewrites him.',
      'Fear: becoming useful to the same system that erased him.',
      'Contradiction: she distrusts institutions but needs their forbidden archive.',
      'Voice style: clipped, dry, emotionally guarded.',
      'Forbidden knowledge: Mara must not know the buyer identity before Act Two.',
    ].join('\n')
  }

  if (phase === 'episode_outline') {
    return [
      authorLine,
      'Artifact: episode_outline',
      '1. Mara finds a dead courier carrying her brother\'s memory shard.',
      '2. The precinct labels the shard counterfeit and closes the case.',
      '3. Mara recruits an ex-runner who knows the harbor tunnels.',
      '4. A public blackout turns the city into an auction floor.',
      '5. The team steals a ledger but exposes Mara\'s private motive.',
      '6. The buyer appears to be helping her.',
      '7. Mara trades safety for the next location.',
      '8. The episode ends with her brother speaking through someone else.',
    ].join('\n')
  }

  if (phase === 'scene_card') {
    return [
      authorLine,
      'Artifact: scene_card',
      'Location: abandoned ferry terminal during a rolling blackout.',
      'Characters: Mara, Ivo, a silent buyer proxy.',
      'Scene goal: force the proxy to reveal where the next auction opens.',
      'Conflict: the proxy only bargains in memories Mara cannot afford to lose.',
      'Subtext: Ivo is testing whether Mara will sacrifice him too.',
      'Turning point: Mara realizes the proxy knows her brother\'s childhood phrase.',
      'Ending hook: the ferry lights turn on by themselves.',
    ].join('\n')
  }

  if (phase === 'dialogue_draft') {
    return [
      authorLine,
      'Artifact: dialogue_draft',
      'INT. ABANDONED FERRY TERMINAL - NIGHT',
      '',
      'Rain needles through the broken roof. Emergency lights breathe red across the empty gates.',
      '',
      'MARA',
      'You picked a dead terminal because you hate witnesses.',
      '',
      'IVO',
      'Or because boats leave slower than people.',
      '',
      'BUYER PROXY',
      'Give me the shard and I give you the door.',
      '',
      'MARA',
      'No. You give me a name first.',
    ].join('\n')
  }

  return [
    authorLine,
    'Artifact: continuity_report',
    'Passed: false',
    'Issue 1 [low_conflict]: the proxy bargains too easily in the scene card.',
    'Issue 2 [forbidden_knowledge]: Mara must not know the buyer identity before Act Two.',
    'Issue 3 [missing_subtext]: Ivo needs a private stake in the terminal exchange.',
  ].join('\n')
}

export function buildWriterRoomCritiqueBody(
  critic: SkillMomentSkillInput,
  index: number,
  artifactKind?: WriterArtifactKind,
): string {
  if (artifactKind === 'continuity_report') {
    return ''
  }

  const criticSlug = normalizeSkillMomentSlug(critic)

  if (criticSlug.includes('continuity')) {
    const continuityNotes = [
      '她不该知道这件事。',
      '时间线还要钉牢。',
      '这一场缺少转折。',
    ]
    return continuityNotes[index % continuityNotes.length]!
  }

  if (criticSlug.includes('showrunner')) {
    const structureNotes = [
      '需要一个更强的尾钩。',
      '结构目标再收紧。',
      '冲突还不够硬。',
    ]
    return structureNotes[index % structureNotes.length]!
  }

  if (criticSlug.includes('character')) {
    const characterNotes = [
      '角色声线变软了。',
      '动机还不够疼。',
      '她的矛盾要更锋利。',
    ]
    return characterNotes[index % characterNotes.length]!
  }

  if (criticSlug.includes('dialogue')) {
    const dialogueNotes = [
      '对白太直白，少解释。',
      '节奏需要更短。',
      '潜台词还没出来。',
    ]
    return dialogueNotes[index % dialogueNotes.length]!
  }

  if (criticSlug.includes('rewrite')) {
    return '改写任务要更具体。'
  }

  return '冲突还不够硬。'
}
