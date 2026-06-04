import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

import type {
  SkillMoment,
  SkillMomentCritique,
  SkillMomentEvolutionCandidate,
  SkillMomentEvolutionCandidateListInput,
  SkillMomentEvolutionCandidateListResult,
  SkillMomentEvolutionCandidateReviewInput,
  SkillMomentEvolutionCandidateReviewResult,
  SkillMomentFeedbackRecordInput,
  SkillMomentFeedbackRecordResult,
  SkillMomentListInput,
  SkillMomentListResult,
} from '@craft-agent/shared/skill-moments'

export type {
  SkillMomentEvolutionCandidate,
  SkillMomentEvolutionCandidateListInput,
  SkillMomentEvolutionCandidateListResult,
  SkillMomentEvolutionCandidateReviewInput,
  SkillMomentEvolutionCandidateReviewResult,
} from '@craft-agent/shared/skill-moments'

export type StoredSkillMoment = Omit<SkillMoment, 'critiques' | 'feedbackVerdict' | 'feedbackSavedPath'>
export type StoredSkillMomentCritique = Omit<SkillMomentCritique, 'feedbackVerdict' | 'feedbackSavedPath'>

export function skillMomentsWorkspaceDir(rootPath: string): string {
  return join(rootPath, 'skill-moments')
}

export function skillMomentFeedbackPath(rootPath: string): string {
  return join(rootPath, 'evals', 'skill_moments_feedback.jsonl')
}

export function skillMomentEvolutionCandidatePath(rootPath: string): string {
  return join(rootPath, 'evals', 'skill_moments_evolution_candidates.jsonl')
}

export async function appendJsonlRecord(filePath: string, record: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf-8')
}

export async function readJsonlRecords<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) {
    return []
  }

  const content = await readFile(filePath, 'utf-8')
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

function skillFeedbackKind(verdict: SkillMomentFeedbackRecordInput['verdict']): 'evolve' | 'unchanged' | 'regress' {
  if (verdict === 1) return 'evolve'
  if (verdict === 2) return 'unchanged'
  return 'regress'
}

type SkillMomentStoredFeedbackRecord = SkillMomentFeedbackRecordInput & {
  sampleKind?: 'evolve' | 'unchanged' | 'regress'
  recordedAt?: string
  response?: string
  target?: {
    kind?: 'moment' | 'critique'
    roomId?: string
    momentId?: string
    critiqueId?: string
  }
  skill?: {
    id?: string
    name?: string
    handle?: string
  }
}

function feedbackTargetKey(record: SkillMomentStoredFeedbackRecord): string {
  return record.critiqueId ? `${record.momentId}:${record.critiqueId}` : record.momentId
}

function compactEvidenceText(text: string, maxLength = 360): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

function candidateIdForFeedback(record: SkillMomentStoredFeedbackRecord): string {
  const target = feedbackTargetKey(record).replace(/[^a-zA-Z0-9_-]+/g, '-')
  const skill = record.skillId.replace(/[^a-zA-Z0-9_-]+/g, '-')
  const time = (record.recordedAt || '').replace(/[^a-zA-Z0-9_-]+/g, '-')
  return `skill-moment-evolution-${skill}-${target}-${time || Date.now()}`
}

function evidenceSourceLinks(record: SkillMomentStoredFeedbackRecord): string[] {
  return record.sourceLinks ?? (record.sources ?? []).map((source) => source.url)
}

function buildCandidateFromFeedback(record: SkillMomentStoredFeedbackRecord): SkillMomentEvolutionCandidate | undefined {
  if (record.verdict !== 1 && record.verdict !== 3) {
    return undefined
  }

  const recordedAt = record.recordedAt || new Date().toISOString()
  const response = compactEvidenceText(record.response || record.messageBody)
  const targetKind: 'moment' | 'critique' = record.critiqueId ? 'critique' : 'moment'
  const target = {
    kind: targetKind,
    roomId: record.roomId,
    momentId: record.momentId,
    critiqueId: record.critiqueId,
  }
  const skill = {
    id: record.skillId,
    name: record.skillName,
    handle: record.handle,
  }
  const kind = record.verdict === 1 ? 'reinforce' : 'guardrail'
  const summary = record.verdict === 1
    ? `Reinforce accepted ${targetKind} behavior for ${record.handle || record.skillName || record.skillId}.`
    : `Add a guardrail against regressed ${targetKind} behavior for ${record.handle || record.skillName || record.skillId}.`
  const instructionHint = record.verdict === 1
    ? `When this skill acts in ${record.roomId}, preserve the useful pattern shown here: ${response}`
    : `When this skill acts in ${record.roomId}, avoid or constrain the weak pattern shown here: ${response}`
  const evidence = {
    verdict: record.verdict,
    recordedAt,
    response,
    sourceLinks: evidenceSourceLinks(record),
  }

  return {
    schemaVersion: 1,
    source: 'debt.skill-moments.feedback',
    status: 'pending_review',
    candidateId: candidateIdForFeedback({ ...record, recordedAt }),
    createdAt: recordedAt,
    roomId: record.roomId,
    skill,
    target,
    proposedInstructionDelta: {
      kind,
      summary,
      instructionHint,
    },
    positiveEvidence: record.verdict === 1 ? [evidence as SkillMomentEvolutionCandidate['positiveEvidence'][number]] : [],
    regressionEvidence: record.verdict === 3 ? [evidence as SkillMomentEvolutionCandidate['regressionEvidence'][number]] : [],
    neutralEvidenceCount: 0,
    doesNotAutoApply: true,
  }
}

export function buildSkillMomentEvolutionCandidates(
  feedbackRecords: SkillMomentStoredFeedbackRecord[],
): SkillMomentEvolutionCandidate[] {
  const latestByTarget = new Map<string, SkillMomentStoredFeedbackRecord>()
  for (const record of feedbackRecords) {
    const key = feedbackTargetKey(record)
    const current = latestByTarget.get(key)
    if (!current || (record.recordedAt || '').localeCompare(current.recordedAt || '') >= 0) {
      latestByTarget.set(key, record)
    }
  }

  return Array.from(latestByTarget.values())
    .flatMap((record) => {
      const candidate = buildCandidateFromFeedback(record)
      return candidate ? [candidate] : []
    })
}

function latestEvolutionCandidatesById(
  records: SkillMomentEvolutionCandidate[],
): Map<string, SkillMomentEvolutionCandidate> {
  const latestByCandidateId = new Map<string, SkillMomentEvolutionCandidate>()
  for (const record of records) {
    latestByCandidateId.set(record.candidateId, record)
  }
  return latestByCandidateId
}

function candidateSortTime(candidate: SkillMomentEvolutionCandidate): string {
  return candidate.reviewedAt ?? candidate.createdAt
}

export async function listSkillMomentEvolutionCandidatesForWorkspace(
  rootPath: string,
  args: Omit<SkillMomentEvolutionCandidateListInput, 'workspaceId'> = {},
): Promise<SkillMomentEvolutionCandidateListResult> {
  const candidatePath = skillMomentEvolutionCandidatePath(rootPath)
  const records = await readJsonlRecords<SkillMomentEvolutionCandidate>(candidatePath)
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200)
  const candidates = Array.from(latestEvolutionCandidatesById(records).values())
    .filter((candidate) => {
      if (args.reviewState === 'pending' && candidate.status !== 'pending_review') {
        return false
      }
      if (args.reviewState === 'reviewed' && candidate.status === 'pending_review') {
        return false
      }
      if (args.status && candidate.status !== args.status) {
        return false
      }
      if (args.roomId && candidate.roomId !== args.roomId) {
        return false
      }
      if (args.skillId && candidate.skill.id !== args.skillId) {
        return false
      }
      return true
    })
    .sort((a, b) => candidateSortTime(b).localeCompare(candidateSortTime(a)))
    .slice(0, limit)

  return { candidates }
}

export async function markSkillMomentEvolutionCandidateReviewedForWorkspace(
  rootPath: string,
  args: Omit<SkillMomentEvolutionCandidateReviewInput, 'workspaceId'>,
): Promise<SkillMomentEvolutionCandidateReviewResult> {
  if (args.status !== 'accepted' && args.status !== 'rejected') {
    throw new Error(`Invalid skill moment evolution candidate review status: ${args.status}`)
  }

  const candidatePath = skillMomentEvolutionCandidatePath(rootPath)
  const records = await readJsonlRecords<SkillMomentEvolutionCandidate>(candidatePath)
  const candidate = latestEvolutionCandidatesById(records).get(args.candidateId)
  if (!candidate) {
    throw new Error(`Skill moment evolution candidate not found: ${args.candidateId}`)
  }

  const reviewedCandidate: SkillMomentEvolutionCandidate = {
    ...candidate,
    status: args.status,
    reviewedAt: args.reviewedAt ?? new Date().toISOString(),
    reviewedBy: args.reviewedBy,
    reviewNote: args.reviewNote,
  }
  await appendJsonlRecord(candidatePath, reviewedCandidate)

  return {
    success: true,
    path: candidatePath,
    candidate: reviewedCandidate,
  }
}

export function applyMomentFeedback(
  moments: SkillMoment[],
  feedbackRecords: Array<SkillMomentFeedbackRecordInput & { path?: string }>,
  feedbackPath: string,
): SkillMoment[] {
  const latestByTarget = new Map<string, SkillMomentFeedbackRecordInput>()
  for (const record of feedbackRecords) {
    const key = record.critiqueId ? `${record.momentId}:${record.critiqueId}` : record.momentId
    latestByTarget.set(key, record)
  }

  return moments.map((moment) => {
    const momentFeedback = latestByTarget.get(moment.id)
    return {
      ...moment,
      feedbackVerdict: momentFeedback?.verdict ?? moment.feedbackVerdict,
      feedbackSavedPath: momentFeedback ? feedbackPath : moment.feedbackSavedPath,
      critiques: moment.critiques.map((critique) => {
        const critiqueFeedback = latestByTarget.get(`${moment.id}:${critique.id}`)
        return {
          ...critique,
          feedbackVerdict: critiqueFeedback?.verdict ?? critique.feedbackVerdict,
          feedbackSavedPath: critiqueFeedback ? feedbackPath : critique.feedbackSavedPath,
        }
      }),
    }
  })
}

export async function readRecentSkillMomentHistory(
  momentsPath: string,
  criticsPath: string,
  roomId: string,
): Promise<{ moments: SkillMoment[]; critiques: SkillMomentCritique[] }> {
  const storedMoments = await readJsonlRecords<StoredSkillMoment>(momentsPath)
  const storedCritics = await readJsonlRecords<StoredSkillMomentCritique>(criticsPath)
  const roomMoments = storedMoments
    .filter((moment) => moment.roomId === roomId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8)
  const momentIds = new Set(roomMoments.map((moment) => moment.id))
  const critiques = storedCritics
    .filter((critique) => momentIds.has(critique.parentMomentId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12)
    .map((critique): SkillMomentCritique => ({ ...critique }))
  const critiquesByMoment = new Map<string, SkillMomentCritique[]>()

  for (const critique of critiques) {
    const entries = critiquesByMoment.get(critique.parentMomentId) ?? []
    entries.push(critique)
    critiquesByMoment.set(critique.parentMomentId, entries)
  }

  return {
    moments: roomMoments.map((moment): SkillMoment => ({
      ...moment,
      critiques: (critiquesByMoment.get(moment.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    })),
    critiques,
  }
}

export async function listSkillMomentsForWorkspace(
  rootPath: string,
  args: Omit<SkillMomentListInput, 'workspaceId'>,
): Promise<SkillMomentListResult> {
  const momentsDir = skillMomentsWorkspaceDir(rootPath)
  const momentsPath = join(momentsDir, 'moments.jsonl')
  const criticsPath = join(momentsDir, 'critics.jsonl')
  const feedbackPath = skillMomentFeedbackPath(rootPath)
  const storedMoments = await readJsonlRecords<StoredSkillMoment>(momentsPath)
  const storedCritics = await readJsonlRecords<StoredSkillMomentCritique>(criticsPath)
  const feedbackRecords = await readJsonlRecords<SkillMomentFeedbackRecordInput>(feedbackPath)
  const criticsByMoment = new Map<string, SkillMomentCritique[]>()

  for (const critique of storedCritics) {
    const entries = criticsByMoment.get(critique.parentMomentId) ?? []
    entries.push({ ...critique })
    criticsByMoment.set(critique.parentMomentId, entries)
  }

  const roomFiltered = args.roomId
    ? storedMoments.filter((moment) => moment.roomId === args.roomId)
    : storedMoments
  const moments = roomFiltered
    .map((moment): SkillMoment => ({
      ...moment,
      critiques: (criticsByMoment.get(moment.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.min(Math.max(args.limit ?? 50, 1), 200))

  return {
    moments: applyMomentFeedback(moments, feedbackRecords, feedbackPath),
  }
}

export async function recordSkillMomentFeedbackForWorkspace(
  rootPath: string,
  args: SkillMomentFeedbackRecordInput,
): Promise<SkillMomentFeedbackRecordResult> {
  if (![1, 2, 3].includes(args.verdict)) {
    throw new Error(`Invalid skill moment feedback verdict: ${args.verdict}`)
  }

  const feedbackPath = skillMomentFeedbackPath(rootPath)
  const targetKind: 'moment' | 'critique' = args.critiqueId ? 'critique' : 'moment'
  const record = {
    schemaVersion: 1,
    source: 'debt.skill-moments.ui',
    recordedAt: args.recordedAt || new Date().toISOString(),
    sampleKind: skillFeedbackKind(args.verdict),
    workspaceId: args.workspaceId,
    verdict: args.verdict,
    roomId: args.roomId,
    momentId: args.momentId,
    critiqueId: args.critiqueId,
    skillId: args.skillId,
    skillName: args.skillName,
    handle: args.handle,
    messageBody: args.messageBody,
    target: {
      kind: targetKind,
      roomId: args.roomId,
      momentId: args.momentId,
      critiqueId: args.critiqueId,
    },
    skill: {
      id: args.skillId,
      name: args.skillName,
      handle: args.handle,
    },
    prompt: args.prompt,
    response: args.messageBody,
    sources: args.sources ?? [],
    sourceLinks: args.sourceLinks ?? (args.sources ?? []).map((source) => source.url),
  }

  await appendJsonlRecord(feedbackPath, record)
  const [candidate] = buildSkillMomentEvolutionCandidates([record])
  if (!candidate) {
    return { success: true, path: feedbackPath }
  }

  const candidatePath = skillMomentEvolutionCandidatePath(rootPath)
  await appendJsonlRecord(candidatePath, candidate)
  return { success: true, path: feedbackPath, evolutionCandidatePath: candidatePath }
}
