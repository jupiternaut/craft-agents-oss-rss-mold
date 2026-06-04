import type { SkillMomentEvolutionCandidate } from '@craft-agent/shared/skill-moments'

export type SkillEvolutionDeltaKind = 'reinforce' | 'guardrail'

export type SkillEvolutionTargetSkill = {
  id: string
  name?: string
  handle?: string
}

export type SkillEvolutionTarget = {
  kind?: 'moment' | 'critique'
  roomId?: string
  momentId?: string
  critiqueId?: string
}

export type SkillEvolutionEvidenceInput = {
  verdict?: 1 | 3
  recordedAt?: string
  response?: string
  sourceLinks?: string[]
}

export type SkillEvolutionCandidateInput = {
  candidateId?: string
  status?: string
  roomId?: string
  skill: SkillEvolutionTargetSkill
  target?: SkillEvolutionTarget
  proposedInstructionDelta?: {
    kind: SkillEvolutionDeltaKind
    summary?: string
    instructionHint?: string
  }
  positiveEvidence?: SkillEvolutionEvidenceInput[]
  regressionEvidence?: SkillEvolutionEvidenceInput[]
  neutralEvidenceCount?: number
  doesNotAutoApply?: boolean
}

export type SkillEvolutionDraftEvidence = {
  candidateId: string
  target?: SkillEvolutionTarget
  recordedAt?: string
  response: string
  sourceLinks: string[]
  proposedSummary?: string
  proposedInstructionHint?: string
}

export type SkillEvolutionDraft = {
  schemaVersion: 1
  source: 'debt.skill-moments.skill-engineer-draft'
  targetSkill: SkillEvolutionTargetSkill
  candidateIds: string[]
  roomIds: string[]
  targets: SkillEvolutionTarget[]
  positiveEvidence: SkillEvolutionDraftEvidence[]
  regressionEvidence: SkillEvolutionDraftEvidence[]
  proposedDeltaMarkdown: string
  doesNotAutoApply: true
}

type DraftGroup = Omit<SkillEvolutionDraft, 'schemaVersion' | 'source' | 'roomIds' | 'proposedDeltaMarkdown' | 'doesNotAutoApply'> & {
  roomIds: Set<string>
}

function compactText(text: string, maxLength = 360): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

function cleanString(value: string | undefined): string | undefined {
  const cleaned = value?.trim()
  return cleaned || undefined
}

function cleanStringList(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
}

function skillKey(skill: SkillEvolutionTargetSkill): string {
  return [
    skill.id,
    skill.handle?.replace(/^@/, ''),
    skill.name,
  ]
    .map((value) => value?.trim().toLocaleLowerCase())
    .find(Boolean) ?? 'unknown-skill'
}

function skillLabel(skill: SkillEvolutionTargetSkill): string {
  return Array.from(new Set([
    cleanString(skill.handle),
    cleanString(skill.name),
    cleanString(skill.id),
  ].filter(Boolean))).join(' / ')
}

function targetLabel(target: SkillEvolutionTarget | undefined): string | undefined {
  if (!target) {
    return undefined
  }

  const pieces = [
    target.kind ? `kind=${target.kind}` : undefined,
    target.roomId ? `room=${target.roomId}` : undefined,
    target.momentId ? `moment=${target.momentId}` : undefined,
    target.critiqueId ? `critique=${target.critiqueId}` : undefined,
  ].filter(Boolean)
  return pieces.length > 0 ? pieces.join(', ') : undefined
}

function normalizeEvidence(args: {
  candidate: SkillEvolutionCandidateInput
  candidateId: string
  evidence: SkillEvolutionEvidenceInput
}): SkillEvolutionDraftEvidence | undefined {
  const response = compactText(args.evidence.response ?? '')
  if (!response) {
    return undefined
  }

  return {
    candidateId: args.candidateId,
    target: args.candidate.target,
    recordedAt: cleanString(args.evidence.recordedAt),
    response,
    sourceLinks: cleanStringList(args.evidence.sourceLinks),
    proposedSummary: cleanString(args.candidate.proposedInstructionDelta?.summary),
    proposedInstructionHint: cleanString(args.candidate.proposedInstructionDelta?.instructionHint),
  }
}

function addCandidateToGroup(
  group: DraftGroup,
  candidate: SkillEvolutionCandidateInput,
  candidateId: string,
): void {
  group.candidateIds.push(candidateId)

  const roomId = cleanString(candidate.roomId) ?? cleanString(candidate.target?.roomId)
  if (roomId) {
    group.roomIds.add(roomId)
  }
  if (candidate.target) {
    group.targets.push(candidate.target)
  }

  for (const evidence of candidate.positiveEvidence ?? []) {
    const normalized = normalizeEvidence({ candidate, candidateId, evidence })
    if (normalized) {
      group.positiveEvidence.push(normalized)
    }
  }

  for (const evidence of candidate.regressionEvidence ?? []) {
    const normalized = normalizeEvidence({ candidate, candidateId, evidence })
    if (normalized) {
      group.regressionEvidence.push(normalized)
    }
  }
}

function renderEvidenceItem(
  evidence: SkillEvolutionDraftEvidence,
  action: string,
): string[] {
  const hint = evidence.proposedInstructionHint ?? evidence.proposedSummary ?? evidence.response
  const lines = [`- ${action}: ${compactText(hint)}`]
  lines.push(`  Evidence: ${evidence.response}`)
  const target = targetLabel(evidence.target)
  if (target) {
    lines.push(`  Target: ${target}`)
  }
  if (evidence.recordedAt) {
    lines.push(`  Recorded at: ${evidence.recordedAt}`)
  }
  if (evidence.sourceLinks.length > 0) {
    lines.push(`  Sources: ${evidence.sourceLinks.join(', ')}`)
  }
  lines.push(`  Candidate: ${evidence.candidateId}`)
  return lines
}

function renderEvidenceSection(
  evidence: SkillEvolutionDraftEvidence[],
  action: string,
): string[] {
  if (evidence.length === 0) {
    return ['- none']
  }

  return evidence.flatMap((item) => renderEvidenceItem(item, action))
}

function renderProposedDeltaMarkdown(group: DraftGroup): string {
  const roomIds = Array.from(group.roomIds)
  return [
    '<!-- Review-only Skill Moments draft. Human approval is required before editing SKILL.md. -->',
    `# SKILL.md Delta Draft: ${skillLabel(group.targetSkill)}`,
    '',
    `Target skill: ${skillLabel(group.targetSkill)}`,
    `Candidate IDs: ${group.candidateIds.join(', ')}`,
    `Rooms: ${roomIds.length > 0 ? roomIds.join(', ') : 'unknown'}`,
    '',
    '## Reinforce',
    ...renderEvidenceSection(group.positiveEvidence, 'Reinforce this behavior pattern'),
    '',
    '## Guardrails',
    ...renderEvidenceSection(group.regressionEvidence, 'Add a guardrail against this regressed pattern'),
    '',
    '## Review Gate',
    '- doesNotAutoApply: true',
    '- This is a delta draft only; do not write SKILL.md from this module.',
  ].join('\n')
}

export function buildDeterministicSkillEvolutionDraft(
  candidates: SkillEvolutionCandidateInput[],
): SkillEvolutionDraft[] {
  const groups = new Map<string, DraftGroup>()

  candidates.forEach((candidate, index) => {
    const candidateId = cleanString(candidate.candidateId) ?? `candidate-${index + 1}`
    const key = skillKey(candidate.skill)
    let group = groups.get(key)
    if (!group) {
      group = {
        targetSkill: candidate.skill,
        candidateIds: [],
        roomIds: new Set<string>(),
        targets: [],
        positiveEvidence: [],
        regressionEvidence: [],
      }
      groups.set(key, group)
    }
    addCandidateToGroup(group, candidate, candidateId)
  })

  return Array.from(groups.values()).map((group) => {
    const roomIds = Array.from(group.roomIds)
    return {
      schemaVersion: 1,
      source: 'debt.skill-moments.skill-engineer-draft',
      targetSkill: group.targetSkill,
      candidateIds: group.candidateIds,
      roomIds,
      targets: group.targets,
      positiveEvidence: group.positiveEvidence,
      regressionEvidence: group.regressionEvidence,
      proposedDeltaMarkdown: renderProposedDeltaMarkdown(group),
      doesNotAutoApply: true,
    }
  })
}

export function buildSkillEvolutionDraftPrompt(
  candidates: SkillEvolutionCandidateInput[],
  instruction?: string,
): string {
  const drafts = buildDeterministicSkillEvolutionDraft(candidates)
  const currentInstruction = cleanString(instruction)

  return [
    'You are the Skill Moments skill-engineer.',
    'Build review-only SKILL.md delta drafts from pending evolution candidates.',
    '',
    'Constraints:',
    '- Do not call a real LLM from this module.',
    '- Do not write SKILL.md.',
    '- Keep doesNotAutoApply=true.',
    '',
    'Current instruction:',
    currentInstruction ? `\`\`\`markdown\n${currentInstruction}\n\`\`\`` : '- none provided',
    '',
    'Deterministic draft context:',
    drafts.length > 0
      ? drafts.map((draft) => draft.proposedDeltaMarkdown).join('\n\n')
      : '- no pending evolution candidates',
  ].join('\n')
}

export function buildSkillEngineerDraftsFromPendingCandidates(
  candidates: SkillMomentEvolutionCandidate[],
): SkillEvolutionDraft[] {
  return buildDeterministicSkillEvolutionDraft(
    candidates.filter((candidate) => candidate.status === 'pending_review'),
  )
}

export function buildSkillEngineerDraftPromptFromPendingCandidates(
  candidates: SkillMomentEvolutionCandidate[],
  instruction?: string,
): string {
  return buildSkillEvolutionDraftPrompt(
    candidates.filter((candidate) => candidate.status === 'pending_review'),
    instruction,
  )
}
