import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

import type {
  SkillMoment,
  SkillMomentCritique,
  SkillMomentFeedbackRecordInput,
  SkillMomentFeedbackRecordResult,
  SkillMomentListInput,
  SkillMomentListResult,
} from '@craft-agent/shared/skill-moments'

export type StoredSkillMoment = Omit<SkillMoment, 'critiques' | 'feedbackVerdict' | 'feedbackSavedPath'>
export type StoredSkillMomentCritique = Omit<SkillMomentCritique, 'feedbackVerdict' | 'feedbackSavedPath'>

export function skillMomentsWorkspaceDir(rootPath: string): string {
  return join(rootPath, 'skill-moments')
}

export function skillMomentFeedbackPath(rootPath: string): string {
  return join(rootPath, 'evals', 'skill_moments_feedback.jsonl')
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
  const record = {
    schemaVersion: 1,
    source: 'debt.skill-moments.ui',
    recordedAt: args.recordedAt || new Date().toISOString(),
    sampleKind: skillFeedbackKind(args.verdict),
    verdict: args.verdict,
    roomId: args.roomId,
    momentId: args.momentId,
    critiqueId: args.critiqueId,
    skillId: args.skillId,
    skillName: args.skillName,
    handle: args.handle,
    messageBody: args.messageBody,
    target: {
      kind: args.critiqueId ? 'critique' : 'moment',
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
  return { success: true, path: feedbackPath }
}
