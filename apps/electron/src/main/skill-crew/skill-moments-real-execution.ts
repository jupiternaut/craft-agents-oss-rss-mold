import type { LoadedSkill } from '@craft-agent/shared/skills/types'
import type { WriterArtifactKind } from '@craft-agent/shared/writer-room'

import type {
  CodexSkillRunResult,
  SkillMoment,
  SkillMomentCritique,
  SkillMomentExecutionMode,
  SkillMomentSkillInput,
  SkillMomentSourceDigest,
} from '../../shared/types'
import type { AgentOSBrowserUseCapability } from './agentos-browser-use'
import { renderAgentOSBrowserUseContext } from './agentos-browser-use'
import { isSkillSilenceText, normalizeSkillMomentSlug } from './room-policies'
import {
  renderSkillActorMemory,
  selectSkillActorMemoryRecords,
  type SkillActorMemoryRecord,
} from './skill-actor-memory'
import {
  loadSkillActorCapsule,
  normalizeSkillActorDecisionOutput,
  renderSkillActorCapsule,
  renderSkillActorDecisionSchema,
  type SkillActorDecisionKind,
  type SkillActorDecisionTrace,
  type SkillActorStateUpdate,
} from './skill-actor-runtime'
import { writerArtifactTag } from './writer-room-mock'

export type SkillMomentInstruction = {
  slug: string
  name: string
  description: string
  content: string
  path: string
}

export type SkillMomentRealPlan = {
  author: SkillMomentSkillInput
  artifactKind?: WriterArtifactKind
}

export type SkillMomentRealExecutor = (args: {
  prompt: string
  workingDirectory?: string
  timeoutMs?: number
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
}) => Promise<CodexSkillRunResult>

export type SkillMomentRealPublication = {
  planIndex: number
  author: SkillMomentSkillInput
  artifactKind?: WriterArtifactKind
  body: string
  prompt: string
  logPath?: string
  decision: SkillActorDecisionKind
  reason?: string
  mediaPrompt?: string
  stateUpdates: SkillActorStateUpdate[]
}

export type SkillMomentRealCritiquePlan = {
  parentMomentId: string
  parentAuthor: SkillMomentSkillInput
  parentBody: string
  critic: SkillMomentSkillInput
  criticIndex: number
  artifactKind?: WriterArtifactKind
}

export type SkillMomentRealCritiquePublication = {
  planIndex: number
  parentMomentId: string
  parentAuthor: SkillMomentSkillInput
  critic: SkillMomentSkillInput
  artifactKind?: WriterArtifactKind
  body: string
  prompt: string
  logPath?: string
  decision: SkillActorDecisionKind
  reason?: string
  stateUpdates: SkillActorStateUpdate[]
}

export type SkillMomentRealExecutionResult = {
  attempted: boolean
  available: boolean
  evaluatedCount: number
  publications: SkillMomentRealPublication[]
  decisions: SkillActorDecisionTrace[]
  errors: string[]
}

type SkillMomentPromptContext = {
  skill: SkillMomentSkillInput
  instruction: SkillMomentInstruction
  roomId: string
  phase?: WriterArtifactKind
  recentMoments: SkillMoment[]
  recentCritiques: SkillMomentCritique[]
  sourceDigests: SkillMomentSourceDigest[]
  actorMemory?: SkillActorMemoryRecord[]
  silencePolicy: string
  browserUse?: AgentOSBrowserUseCapability
}

type SkillMomentCritiquePromptContext = SkillMomentPromptContext & {
  parentMomentId: string
  parentAuthor: SkillMomentSkillInput
  parentBody: string
}

type NormalizedRealOutput =
  | { kind: 'publish'; body: string }
  | { kind: 'silence' }
  | { kind: 'reject'; reason: string }

const DEFAULT_MIN_MOMENT_GRAPHEMES = 20

function compactText(text: string, maxLength = 700): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

function stripWrappingFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:markdown|md|text|plain)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function renderRecentMoments(moments: SkillMoment[]): string {
  if (moments.length === 0) {
    return '- none'
  }

  return moments
    .slice(0, 8)
    .map((moment) => [
      `- ${moment.skillName} ${moment.handle} (${moment.createdAt})`,
      `  body: ${compactText(moment.body)}`,
      moment.artifacts?.length ? `  artifacts: ${moment.artifacts.join(', ')}` : '',
    ].filter(Boolean).join('\n'))
    .join('\n')
}

function renderRecentCritiques(critiques: SkillMomentCritique[]): string {
  if (critiques.length === 0) {
    return '- none'
  }

  return critiques
    .slice(0, 12)
    .map((critique) => (
      `- ${critique.criticSkillName} ${critique.criticHandle}: ${compactText(critique.body, 220)}`
    ))
    .join('\n')
}

function renderSourceDigests(sourceDigests: SkillMomentSourceDigest[]): string {
  if (sourceDigests.length === 0) {
    return '- none'
  }

  return sourceDigests.map((digest) => [
    `- [${digest.source}] ${digest.title}`,
    `  status: ${digest.status}`,
    `  url: ${digest.url}`,
    `  summary: ${compactText(digest.summary, 500)}`,
  ].join('\n')).join('\n')
}

export function resolveSkillMomentExecutionMode(
  inputMode?: SkillMomentExecutionMode,
  envMode = process.env.CRAFT_SKILL_MOMENTS_MODE,
): SkillMomentExecutionMode {
  if (inputMode === 'real' || inputMode === 'mock') {
    return inputMode
  }

  return envMode?.trim().toLocaleLowerCase() === 'real' ? 'real' : 'mock'
}

export function skillMomentInstructionFromLoadedSkill(skill: LoadedSkill): SkillMomentInstruction {
  return {
    slug: skill.slug,
    name: skill.metadata.name || skill.slug,
    description: skill.metadata.description || '',
    content: skill.content,
    path: skill.path,
  }
}

export function findSkillMomentInstruction(
  skill: SkillMomentSkillInput,
  instructions: SkillMomentInstruction[],
): SkillMomentInstruction | undefined {
  const aliases = new Set([
    normalizeSkillMomentSlug(skill),
    skill.id.trim().toLocaleLowerCase(),
    skill.handle.replace(/^@/, '').trim().toLocaleLowerCase(),
    skill.name.trim().toLocaleLowerCase(),
  ].filter(Boolean))

  return instructions.find((instruction) => {
    const slug = instruction.slug.trim().toLocaleLowerCase()
    const name = instruction.name.trim().toLocaleLowerCase()
    return aliases.has(slug) || aliases.has(name)
  })
}

export function normalizeRealSkillMomentOutput(
  text: string | undefined,
  minGraphemes = DEFAULT_MIN_MOMENT_GRAPHEMES,
): NormalizedRealOutput {
  const body = stripWrappingFence(text ?? '')
  if (isSkillSilenceText(body)) {
    return { kind: 'silence' }
  }

  if (!body) {
    return { kind: 'reject', reason: 'empty output' }
  }

  if (Array.from(body).length < minGraphemes) {
    return { kind: 'reject', reason: 'too-short output' }
  }

  return { kind: 'publish', body }
}

export function realSkillMomentArtifacts(artifactKind?: WriterArtifactKind): string[] {
  if (artifactKind) {
    return ['writer_room_real_moment', writerArtifactTag(artifactKind)]
  }

  return ['agentos_real_moment']
}

export function buildSkillMomentRealPrompt(context: SkillMomentPromptContext): string {
  const phaseLine = context.phase
    ? `current screenplay phase/artifact: ${context.phase}`
    : 'current screenplay phase/artifact: n/a'
  const actorCapsule = loadSkillActorCapsule(context.instruction)

  return [
    'You are running inside Craft Agents Skill Moments.',
    'Use the loaded skill instruction below as your role and boundary. Do not invent a different persona.',
    'Stable actor capsule comes first for prompt-cache reuse. Dynamic room context follows.',
    '',
    '<ACTOR_CAPSULE>',
    renderSkillActorCapsule(actorCapsule),
    '</ACTOR_CAPSULE>',
    '',
    '<SKILL_MD>',
    `slug: ${context.instruction.slug}`,
    `name: ${context.instruction.name}`,
    `description: ${context.instruction.description}`,
    `skill_dir: ${context.instruction.path}`,
    '',
    context.instruction.content.trim(),
    '</SKILL_MD>',
    '',
    '<ROOM_CONTEXT>',
    `roomId: ${context.roomId}`,
    `selected_skill: ${context.skill.name} ${context.skill.handle}`,
    phaseLine,
    '</ROOM_CONTEXT>',
    '',
    '<ACTOR_MEMORY>',
    renderSkillActorMemory(context.actorMemory ?? []),
    '</ACTOR_MEMORY>',
    '',
    '<RECENT_MOMENTS>',
    renderRecentMoments(context.recentMoments),
    '</RECENT_MOMENTS>',
    '',
    '<RECENT_CRITIQUES>',
    renderRecentCritiques(context.recentCritiques),
    '</RECENT_CRITIQUES>',
    '',
    '<SOURCE_DIGESTS>',
    renderSourceDigests(context.sourceDigests),
    '</SOURCE_DIGESTS>',
    '',
    '<SILENCE_POLICY>',
    context.silencePolicy,
    '</SILENCE_POLICY>',
    '',
    renderAgentOSBrowserUseContext(context.browserUse ?? {
      enabled: false,
      provider: 'brave',
      browserName: 'Brave Browser',
      executablePath: '',
      profileDir: '',
      remoteDebuggingPort: 9233,
      policy: 'read_only',
      reason: 'AgentOS Browser Use context was not provided',
    }),
    '',
    'Output contract:',
    '- If you cannot add a concrete new question, evidence link, action, conflict, artifact progress, or critique-worthy claim, output exactly <SILENCE/>.',
    '- Otherwise output only the Skill Moment body.',
    '- Treat ACTOR_MEMORY as private durable continuity. Continue grudges, promises, goals, and relationship heat from it, but do not quote it mechanically.',
    '- For persona/social rooms, make the body dramatic: show what the character wants, what they do next, who blocks them, and one visible image or staging detail.',
    '- Treat source digests as off-screen triggers or props, not as feed copy. Do not open with "I read..." or quote a source title unless the skill is explicitly an analyst/research persona.',
    '- In persona/social rooms, the selected skill should act from its own agenda. Power-celebrity roles should create media fights, loyalty tests, rally posts, enemy labels, polls, repost bait, or public image stunts instead of calmly summarizing sources.',
    '- Avoid status announcements and repeated comeback lines such as "I am back" or "我回来了"; a moment must change the scene.',
    '- Use decision="media_request" when the moment needs a generated image; include both body and media_prompt.',
    '- Include state_updates whenever this decision changes the actor mood, goal, relationship, unresolved conflict, media intent, or cooldown.',
    '- Do not include analysis wrappers, Markdown fences, or explanations of the contract.',
    '- Do not edit files. Browser Use is only allowed under the read-only policy above; if referenced files or sources are absent from context and Browser Use is unavailable, say the missing context in the body.',
    '',
    '<STRUCTURED_DECISION_SCHEMA>',
    renderSkillActorDecisionSchema(),
    '</STRUCTURED_DECISION_SCHEMA>',
  ].join('\n')
}

export function buildSkillMomentRealCritiquePrompt(context: SkillMomentCritiquePromptContext): string {
  const phaseLine = context.phase
    ? `current screenplay phase/artifact: ${context.phase}`
    : 'current screenplay phase/artifact: n/a'
  const actorCapsule = loadSkillActorCapsule(context.instruction)

  return [
    'You are running inside Craft Agents Skill Moments.',
    'Use the loaded skill instruction below as your role and boundary. Do not invent a different persona.',
    'You are writing a comment under one parent moment, not a new top-level moment.',
    'Stable actor capsule comes first for prompt-cache reuse. Dynamic room context follows.',
    '',
    '<ACTOR_CAPSULE>',
    renderSkillActorCapsule(actorCapsule),
    '</ACTOR_CAPSULE>',
    '',
    '<SKILL_MD>',
    `slug: ${context.instruction.slug}`,
    `name: ${context.instruction.name}`,
    `description: ${context.instruction.description}`,
    `skill_dir: ${context.instruction.path}`,
    '',
    context.instruction.content.trim(),
    '</SKILL_MD>',
    '',
    '<ROOM_CONTEXT>',
    `roomId: ${context.roomId}`,
    `selected_critic: ${context.skill.name} ${context.skill.handle}`,
    phaseLine,
    '</ROOM_CONTEXT>',
    '',
    '<PARENT_MOMENT>',
    `momentId: ${context.parentMomentId}`,
    `author: ${context.parentAuthor.name} ${context.parentAuthor.handle}`,
    `body: ${compactText(context.parentBody, 900)}`,
    '</PARENT_MOMENT>',
    '',
    '<ACTOR_MEMORY>',
    renderSkillActorMemory(context.actorMemory ?? []),
    '</ACTOR_MEMORY>',
    '',
    '<RECENT_MOMENTS>',
    renderRecentMoments(context.recentMoments),
    '</RECENT_MOMENTS>',
    '',
    '<RECENT_CRITIQUES>',
    renderRecentCritiques(context.recentCritiques),
    '</RECENT_CRITIQUES>',
    '',
    '<SOURCE_DIGESTS>',
    renderSourceDigests(context.sourceDigests),
    '</SOURCE_DIGESTS>',
    '',
    '<SILENCE_POLICY>',
    context.silencePolicy,
    '</SILENCE_POLICY>',
    '',
    renderAgentOSBrowserUseContext(context.browserUse ?? {
      enabled: false,
      provider: 'brave',
      browserName: 'Brave Browser',
      executablePath: '',
      profileDir: '',
      remoteDebuggingPort: 9233,
      policy: 'read_only',
      reason: 'AgentOS Browser Use context was not provided',
    }),
    '',
    'Output contract:',
    '- If you cannot add a concrete conflict beat, pressure point, evidence demand, relationship shift, or useful critique under the parent moment, output exactly <SILENCE/>.',
    '- Otherwise output only one comment body for this parent moment.',
    '- Prefer decision="critique". decision="speak" is accepted only as a plain comment. Do not use decision="media_request" for comments.',
    '- Treat ACTOR_MEMORY as private durable continuity. Continue grudges, promises, goals, and relationship heat from it, but do not quote it mechanically.',
    '- For persona/social rooms, the comment should sound like this actor reacting from their own agenda, not like a neutral summary.',
    '- Avoid low-value praise such as "点赞", "收到", "欢迎回来", or generic agreement.',
    '- Include state_updates whenever this comment changes the actor mood, goal, relationship, unresolved conflict, or cooldown.',
    '- Do not include analysis wrappers, Markdown fences, or explanations of the contract.',
    '',
    '<STRUCTURED_DECISION_SCHEMA>',
    renderSkillActorDecisionSchema(),
    '</STRUCTURED_DECISION_SCHEMA>',
  ].join('\n')
}

export async function executeRealSkillMomentPlans(args: {
  plans: SkillMomentRealPlan[]
  instructions: SkillMomentInstruction[]
  roomId: string
  sourceDigests: SkillMomentSourceDigest[]
  actorMemoryRecords?: SkillActorMemoryRecord[]
  recentMoments: SkillMoment[]
  recentCritiques: SkillMomentCritique[]
  silencePolicy: string
  browserUse?: AgentOSBrowserUseCapability
  executor: SkillMomentRealExecutor
  workingDirectory?: string
  timeoutMs?: number
  minBodyGraphemes?: number
}): Promise<SkillMomentRealExecutionResult> {
  const errors: string[] = []
  const publications: SkillMomentRealPublication[] = []
  const decisions: SkillActorDecisionTrace[] = []
  let evaluatedCount = 0

  for (const [planIndex, plan] of args.plans.entries()) {
    const instruction = findSkillMomentInstruction(plan.author, args.instructions)
    if (!instruction) {
      errors.push(`Missing SKILL.md instruction for ${plan.author.handle}`)
      decisions.push({
        planIndex,
        author: plan.author,
        decision: 'reject',
        reason: `Missing SKILL.md instruction for ${plan.author.handle}`,
      })
      continue
    }

    const prompt = buildSkillMomentRealPrompt({
      skill: plan.author,
      instruction,
      roomId: args.roomId,
      phase: plan.artifactKind,
      actorMemory: selectSkillActorMemoryRecords({
        records: args.actorMemoryRecords ?? [],
        roomId: args.roomId,
        skill: plan.author,
      }),
      recentMoments: args.recentMoments,
      recentCritiques: args.recentCritiques,
      sourceDigests: args.sourceDigests,
      silencePolicy: args.silencePolicy,
      browserUse: args.browserUse,
    })
    const result = await args.executor({
      prompt,
      workingDirectory: args.workingDirectory,
      timeoutMs: args.timeoutMs,
      reasoningEffort: 'low',
    })

    if (!result.success) {
      errors.push(result.error || `Skill execution failed for ${plan.author.handle}`)
      decisions.push({
        planIndex,
        author: plan.author,
        decision: 'reject',
        reason: result.error || 'skill execution failed',
      })
      continue
    }

    evaluatedCount += 1
    const normalized = normalizeSkillActorDecisionOutput({
      text: result.text,
      author: plan.author,
      recentBodies: [
        ...args.recentMoments.map((moment) => moment.body),
        ...publications.map((publication) => publication.body),
      ],
      minBodyGraphemes: args.minBodyGraphemes,
    })
    if (normalized.kind === 'silence') {
      decisions.push({
        planIndex,
        author: plan.author,
        decision: 'silence',
        reason: normalized.reason,
        stateUpdates: normalized.stateUpdates,
      })
      continue
    }
    if (normalized.kind === 'reject') {
      errors.push(`${plan.author.handle}: ${normalized.reason}`)
      decisions.push({
        planIndex,
        author: plan.author,
        decision: 'reject',
        reason: normalized.reason,
      })
      continue
    }

    decisions.push({
      planIndex,
      author: plan.author,
      decision: normalized.decision.decision,
      reason: normalized.decision.reason,
      body: normalized.body,
      mediaPrompt: normalized.mediaPrompt,
      stateUpdates: normalized.stateUpdates,
    })
    publications.push({
      planIndex,
      author: plan.author,
      artifactKind: plan.artifactKind,
      body: normalized.body,
      prompt,
      logPath: result.logPath,
      decision: normalized.decision.decision,
      reason: normalized.decision.reason,
      mediaPrompt: normalized.mediaPrompt,
      stateUpdates: normalized.stateUpdates,
    })
  }

  return {
    attempted: args.plans.length > 0,
    available: evaluatedCount > 0,
    evaluatedCount,
    publications,
    decisions,
    errors,
  }
}

export async function executeRealSkillMomentCritiquePlans(args: {
  plans: SkillMomentRealCritiquePlan[]
  instructions: SkillMomentInstruction[]
  roomId: string
  sourceDigests: SkillMomentSourceDigest[]
  actorMemoryRecords?: SkillActorMemoryRecord[]
  recentMoments: SkillMoment[]
  recentCritiques: SkillMomentCritique[]
  silencePolicy: string
  browserUse?: AgentOSBrowserUseCapability
  executor: SkillMomentRealExecutor
  workingDirectory?: string
  timeoutMs?: number
  minBodyGraphemes?: number
}): Promise<{
  attempted: boolean
  available: boolean
  evaluatedCount: number
  publications: SkillMomentRealCritiquePublication[]
  decisions: SkillActorDecisionTrace[]
  errors: string[]
}> {
  const errors: string[] = []
  const publications: SkillMomentRealCritiquePublication[] = []
  const decisions: SkillActorDecisionTrace[] = []
  let evaluatedCount = 0

  for (const [planIndex, plan] of args.plans.entries()) {
    const instruction = findSkillMomentInstruction(plan.critic, args.instructions)
    const target = { kind: 'moment' as const, momentId: plan.parentMomentId }
    if (!instruction) {
      errors.push(`Missing SKILL.md instruction for ${plan.critic.handle}`)
      decisions.push({
        planIndex,
        author: plan.critic,
        target,
        decision: 'reject',
        reason: `Missing SKILL.md instruction for ${plan.critic.handle}`,
      })
      continue
    }

    const prompt = buildSkillMomentRealCritiquePrompt({
      skill: plan.critic,
      instruction,
      roomId: args.roomId,
      phase: plan.artifactKind,
      parentMomentId: plan.parentMomentId,
      parentAuthor: plan.parentAuthor,
      parentBody: plan.parentBody,
      actorMemory: selectSkillActorMemoryRecords({
        records: args.actorMemoryRecords ?? [],
        roomId: args.roomId,
        skill: plan.critic,
      }),
      recentMoments: args.recentMoments,
      recentCritiques: args.recentCritiques,
      sourceDigests: args.sourceDigests,
      silencePolicy: args.silencePolicy,
      browserUse: args.browserUse,
    })
    const result = await args.executor({
      prompt,
      workingDirectory: args.workingDirectory,
      timeoutMs: args.timeoutMs,
      reasoningEffort: 'low',
    })

    if (!result.success) {
      errors.push(result.error || `Skill critique execution failed for ${plan.critic.handle}`)
      decisions.push({
        planIndex,
        author: plan.critic,
        target,
        decision: 'reject',
        reason: result.error || 'skill critique execution failed',
      })
      continue
    }

    evaluatedCount += 1
    const normalized = normalizeSkillActorDecisionOutput({
      text: result.text,
      author: plan.critic,
      recentBodies: [
        ...args.recentCritiques.map((critique) => critique.body),
        ...publications.map((publication) => publication.body),
      ],
      minBodyGraphemes: args.minBodyGraphemes,
    })
    if (normalized.kind === 'silence') {
      decisions.push({
        planIndex,
        author: plan.critic,
        target,
        decision: 'silence',
        reason: normalized.reason,
        stateUpdates: normalized.stateUpdates,
      })
      continue
    }
    if (normalized.kind === 'reject') {
      errors.push(`${plan.critic.handle}: ${normalized.reason}`)
      decisions.push({
        planIndex,
        author: plan.critic,
        target,
        decision: 'reject',
        reason: normalized.reason,
      })
      continue
    }

    decisions.push({
      planIndex,
      author: plan.critic,
      target,
      decision: normalized.decision.decision,
      reason: normalized.decision.reason,
      body: normalized.body,
      mediaPrompt: normalized.mediaPrompt,
      stateUpdates: normalized.stateUpdates,
    })
    publications.push({
      planIndex,
      parentMomentId: plan.parentMomentId,
      parentAuthor: plan.parentAuthor,
      critic: plan.critic,
      artifactKind: plan.artifactKind,
      body: normalized.body,
      prompt,
      logPath: result.logPath,
      decision: normalized.decision.decision,
      reason: normalized.decision.reason,
      stateUpdates: normalized.stateUpdates,
    })
  }

  return {
    attempted: args.plans.length > 0,
    available: evaluatedCount > 0,
    evaluatedCount,
    publications,
    decisions,
    errors,
  }
}
