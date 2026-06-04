export type SkillActorDecisionKind = 'speak' | 'silence' | 'media_request' | 'critique'

export type SkillActorSkillInput = {
  id: string
  name: string
  handle: string
}

export type SkillActorInstructionInput = {
  slug: string
  name: string
  description: string
  content: string
  path: string
}

export type SkillActorCapsule = {
  slug: string
  name: string
  description: string
  path: string
  instruction: string
  summary: string
  persona: string
  responsibilities: string[]
  speakWhen: string[]
  staySilentWhen: string[]
  outputContract: string[]
  relationships: string[]
}

export type SkillActorStateUpdate = {
  field: string
  value: string
}

export type SkillActorDecision = {
  decision: SkillActorDecisionKind
  body?: string
  reason?: string
  mediaPrompt?: string
  artifactKind?: string
  stateUpdates?: SkillActorStateUpdate[] | Record<string, unknown>
}

export type NormalizedSkillActorDecision =
  | {
    kind: 'publish'
    decision: SkillActorDecision
    body: string
    mediaPrompt?: string
    stateUpdates: SkillActorStateUpdate[]
  }
  | {
    kind: 'silence'
    decision?: SkillActorDecision
    reason?: string
    stateUpdates: SkillActorStateUpdate[]
  }
  | {
    kind: 'reject'
    reason: string
    decision?: SkillActorDecision
  }

export type SkillActorDecisionTrace = {
  planIndex: number
  author: SkillActorSkillInput
  decision: SkillActorDecisionKind | 'reject'
  target?: {
    kind: 'moment' | 'critique'
    momentId?: string
    critiqueId?: string
  }
  reason?: string
  body?: string
  mediaPrompt?: string
  stateUpdates?: SkillActorStateUpdate[]
}

type Section = {
  title: string
  body: string
}

const DEFAULT_MIN_BODY_GRAPHEMES = 20
const LOW_VALUE_REACTION = /^(?:@[\w-]+\s*)?(?:已点赞|点赞|赞|支持|欢迎回来|收到|转发|mark|liked this)[。.!！\s]*$/i
const COMEBACK_REPETITION = /(?:我回来了|我复活了|I am back|I'm back)/i

function compactWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function summarizeSkillMarkdown(markdown: string): string {
  const summary = compactWhitespace(
    markdown
      .replace(/^---\s*[\s\S]*?\s*---\s*/, '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*_`[\]]/g, ' '),
  )
  if (!summary) {
    return 'No SKILL.md content provided.'
  }

  const graphemes = Array.from(summary)
  return graphemes.length > 420 ? `${graphemes.slice(0, 420).join('')}...` : summary
}

function stripWrappingFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json|markdown|md|text|plain)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function parseSections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/)
  const sections: Section[] = []
  let currentTitle = 'Root'
  let currentLines: string[] = []

  const flush = () => {
    const body = currentLines.join('\n').trim()
    if (body) {
      sections.push({ title: currentTitle, body })
    }
  }

  for (const line of lines) {
    const match = line.match(/^(#{1,4})\s+(.+?)\s*$/)
    if (match) {
      flush()
      currentTitle = match[2]!.trim()
      currentLines = []
      continue
    }
    currentLines.push(line)
  }
  flush()

  return sections
}

function sectionMatches(title: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(title))
}

function collectSections(sections: Section[], patterns: RegExp[], fallback = ''): string[] {
  const matches = sections
    .filter((section) => sectionMatches(section.title, patterns))
    .map((section) => compactWhitespace(section.body))
    .filter(Boolean)
  if (matches.length > 0) {
    return matches
  }
  return fallback ? [compactWhitespace(fallback)] : []
}

function firstSection(sections: Section[], patterns: RegExp[], fallback: string): string {
  return collectSections(sections, patterns, fallback)[0] ?? compactWhitespace(fallback)
}

function normalizeStateUpdates(value: unknown): SkillActorStateUpdate[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([field, rawValue]) => {
      const normalizedValue = typeof rawValue === 'string'
        ? rawValue.trim()
        : rawValue == null
          ? ''
          : JSON.stringify(rawValue)
      return field.trim() && normalizedValue ? [{ field: field.trim(), value: normalizedValue }] : []
    })
  }

  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item): SkillActorStateUpdate[] => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const record = item as Record<string, unknown>
    const field = typeof record.field === 'string' ? record.field.trim() : ''
    const rawValue = record.value
    const normalizedValue = typeof rawValue === 'string'
      ? rawValue.trim()
      : rawValue == null
        ? ''
        : JSON.stringify(rawValue)
    if (!field || !normalizedValue) {
      return []
    }
    return [{ field, value: normalizedValue }]
  })
}

function parseDecisionKind(value: unknown): SkillActorDecisionKind | undefined {
  const normalized = typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
  if (normalized === 'speak' || normalized === 'publish' || normalized === 'moment') {
    return 'speak'
  }
  if (normalized === 'silence' || normalized === '<silence/>') {
    return 'silence'
  }
  if (normalized === 'media_request' || normalized === 'media' || normalized === 'image') {
    return 'media_request'
  }
  if (normalized === 'critique' || normalized === 'comment') {
    return 'critique'
  }
  return undefined
}

function extractJsonObject(text: string): unknown | undefined {
  const stripped = stripWrappingFence(text)
  if (!stripped.startsWith('{')) {
    return undefined
  }

  try {
    return JSON.parse(stripped)
  } catch {
    return undefined
  }
}

function normalizeDecisionRecord(record: unknown): SkillActorDecision | undefined {
  if (!record || typeof record !== 'object') {
    return undefined
  }

  const raw = record as Record<string, unknown>
  const body = typeof raw.body === 'string'
    ? raw.body.trim()
    : typeof raw.moment_body === 'string'
      ? raw.moment_body.trim()
      : undefined
  const mediaPrompt = typeof raw.mediaPrompt === 'string'
    ? raw.mediaPrompt.trim()
    : typeof raw.media_prompt === 'string'
      ? raw.media_prompt.trim()
      : undefined
  const decision = parseDecisionKind(raw.decision)
    ?? (mediaPrompt ? 'media_request' : body ? 'speak' : undefined)
  if (!decision) {
    return undefined
  }

  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : undefined
  const artifactKind = typeof raw.artifactKind === 'string'
    ? raw.artifactKind.trim()
    : typeof raw.artifact_kind === 'string'
      ? raw.artifact_kind.trim()
      : undefined

  return {
    decision,
    body,
    reason,
    mediaPrompt,
    artifactKind,
    stateUpdates: normalizeStateUpdates(raw.stateUpdates ?? raw.state_updates),
  }
}

export function normalizeSkillActorDecision(record: unknown): SkillActorDecision | undefined {
  return normalizeDecisionRecord(record)
}

export function loadSkillActorCapsule(instruction: SkillActorInstructionInput): SkillActorCapsule {
  const sections = parseSections(instruction.content)
  const summary = summarizeSkillMarkdown(instruction.content || instruction.description)
  const root = firstSection(sections, [/^root$/i], instruction.description || summary)

  return {
    slug: instruction.slug,
    name: instruction.name,
    description: instruction.description,
    path: instruction.path,
    instruction: instruction.content.trim(),
    summary,
    persona: firstSection(sections, [/persona/i, /core persona/i, /identity/i, /voice/i, /style/i, /speech texture/i, /角色/, /身份/, /人设/], root || summary),
    responsibilities: collectSections(sections, [/role boundary/i, /responsibil/i, /skill contract/i, /职责/, /任务/, /使命/], summary),
    speakWhen: collectSections(sections, [/speak when/i, /dialogue mechanics/i, /skill moments/i, /room relationships/i, /发言/, /说话/, /参与/], summary),
    staySilentWhen: collectSections(sections, [/stay silent/i, /silence/i, /boundaries/i, /沉默/, /不发言/, /不要回应/], summary),
    outputContract: collectSections(sections, [/output contract/i, /critique contract/i, /response shape/i, /输出/, /格式/, /契约/], summary),
    relationships: collectSections(sections, [/room relationships/i, /relationships/i, /关系/, /对手/, /盟友/], summary),
  }
}

export function extractSkillActorCapsule(skillMarkdown: string): SkillActorCapsule {
  return loadSkillActorCapsule({
    slug: '',
    name: '',
    description: '',
    content: skillMarkdown,
    path: '',
  })
}

export function renderSkillActorCapsule(capsule: SkillActorCapsule): string {
  return [
    `slug: ${capsule.slug}`,
    `name: ${capsule.name}`,
    `description: ${capsule.description || 'n/a'}`,
    `skill_dir: ${capsule.path}`,
    '',
    'persona:',
    capsule.persona || 'Use the SKILL.md instruction as the persona source of truth.',
    '',
    'responsibilities:',
    capsule.responsibilities.length ? capsule.responsibilities.map((item) => `- ${item}`).join('\n') : '- Follow SKILL.md role boundaries.',
    '',
    'speak_when:',
    capsule.speakWhen.length ? capsule.speakWhen.map((item) => `- ${item}`).join('\n') : '- Speak only when you can change the room.',
    '',
    'stay_silent_when:',
    capsule.staySilentWhen.length ? capsule.staySilentWhen.map((item) => `- ${item}`).join('\n') : '- Return <SILENCE/> for filler.',
    '',
    'relationships:',
    capsule.relationships.length ? capsule.relationships.map((item) => `- ${item}`).join('\n') : '- Use recent room history to infer relationships conservatively.',
    '',
    'output_contract:',
    capsule.outputContract.length ? capsule.outputContract.map((item) => `- ${item}`).join('\n') : '- Return structured SkillActorDecision JSON.',
  ].join('\n')
}

export function renderSkillActorDecisionSchema(): string {
  return [
    'Return exactly one JSON object matching this contract, with no markdown fence:',
    '{',
    '  "decision": "speak" | "silence" | "media_request" | "critique",',
    '  "body": "moment body when decision is speak/media_request/critique",',
    '  "reason": "short private reason for AgentOS traces",',
    '  "media_prompt": "optional image prompt when decision is media_request",',
    '  "artifact_kind": "optional artifact tag or screenplay phase",',
    '  "state_updates": [{ "field": "current_emotion|relationship.<handle>|last_claim|cooldown_hint", "value": "..." }]',
    '}',
    'Use {"decision":"silence","reason":"..."} instead of weak filler.',
  ].join('\n')
}

export function judgeSkillActorDecision(args: {
  decision: SkillActorDecision
  author?: SkillActorSkillInput
  recentBodies?: string[]
  minBodyGraphemes?: number
}): { keep: boolean; reason?: string } {
  if (args.decision.decision === 'silence') {
    return { keep: false, reason: args.decision.reason || 'silence' }
  }

  const body = args.decision.body?.trim() ?? ''
  if (!body) {
    return { keep: false, reason: 'empty body' }
  }

  const minBodyGraphemes = args.minBodyGraphemes ?? DEFAULT_MIN_BODY_GRAPHEMES
  if (COMEBACK_REPETITION.test(body)) {
    return { keep: false, reason: 'repeated comeback line' }
  }

  if (LOW_VALUE_REACTION.test(body)) {
    return { keep: false, reason: 'low-value praise' }
  }

  if (Array.from(body).length < minBodyGraphemes) {
    return { keep: false, reason: 'too-short body' }
  }

  if (args.decision.decision === 'media_request' && !compactWhitespace(args.decision.mediaPrompt ?? '')) {
    return { keep: false, reason: 'missing mediaPrompt' }
  }

  const normalizedBody = compactWhitespace(body).toLocaleLowerCase()
  if ((args.recentBodies ?? []).some((recent) => compactWhitespace(recent).toLocaleLowerCase() === normalizedBody)) {
    return { keep: false, reason: 'duplicate recent body' }
  }

  return { keep: true }
}

export function normalizeSkillActorDecisionOutput(args: {
  text?: string
  author?: SkillActorSkillInput
  recentBodies?: string[]
  minBodyGraphemes?: number
}): NormalizedSkillActorDecision {
  const stripped = stripWrappingFence(args.text ?? '')
  if (!stripped) {
    return { kind: 'reject', reason: 'empty output' }
  }

  const silenceMarker = stripped.toLocaleLowerCase()
  if (silenceMarker === '<silence/>' || silenceMarker === 'silence') {
    return { kind: 'silence', reason: 'silence marker', stateUpdates: [] }
  }

  const parsed = normalizeDecisionRecord(extractJsonObject(stripped))
  const decision: SkillActorDecision = parsed ?? {
    decision: 'speak',
    body: stripped,
    stateUpdates: [],
  }

  const judgement = judgeSkillActorDecision({
    decision,
    author: args.author,
    recentBodies: args.recentBodies,
    minBodyGraphemes: args.minBodyGraphemes,
  })

  if (decision.decision === 'silence') {
    return {
      kind: 'silence',
      decision,
      reason: decision.reason || judgement.reason,
      stateUpdates: normalizeStateUpdates(decision.stateUpdates),
    }
  }

  if (!judgement.keep) {
    return { kind: 'reject', reason: judgement.reason || 'rejected by judge', decision }
  }

  return {
    kind: 'publish',
    decision,
    body: (decision.body ?? decision.mediaPrompt ?? '').trim(),
    mediaPrompt: decision.mediaPrompt,
    stateUpdates: normalizeStateUpdates(decision.stateUpdates),
  }
}

export function parseSkillActorDecisionOutput(
  text?: string,
  options: {
    author?: SkillActorSkillInput
    recentBodies?: string[]
    minBodyGraphemes?: number
  } = {},
): NormalizedSkillActorDecision {
  return normalizeSkillActorDecisionOutput({
    text,
    author: options.author,
    recentBodies: options.recentBodies,
    minBodyGraphemes: options.minBodyGraphemes,
  })
}
