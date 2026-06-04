import type {
  SkillActorDecisionKind,
  SkillActorDecisionTrace,
  SkillActorSkillInput,
} from './skill-actor-runtime'

export type SkillActorMemoryRecord = {
  schemaVersion: 1
  workspaceId: string
  roomId: string
  runId: string
  planIndex: number
  skillId: string
  skillName: string
  handle: string
  field: string
  value: string
  sourceDecision: SkillActorDecisionKind | 'reject'
  targetKind?: 'moment' | 'critique'
  targetMomentId?: string
  targetCritiqueId?: string
  sourceReason?: string
  createdAt: string
}

function compactMemoryText(text: string, maxLength = 360): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

function normalizeKey(value: string | undefined): string {
  return (value ?? '').replace(/^@/, '').trim().toLocaleLowerCase()
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function matchesSkill(record: SkillActorMemoryRecord, skill: SkillActorSkillInput): boolean {
  const skillKeys = new Set([
    normalizeKey(skill.id),
    normalizeKey(skill.name),
    normalizeKey(skill.handle),
  ].filter(Boolean))

  return [
    normalizeKey(stringField(record.skillId)),
    normalizeKey(stringField(record.skillName)),
    normalizeKey(stringField(record.handle)),
  ].some((key) => skillKeys.has(key))
}

export function buildSkillActorMemoryRecords(args: {
  decision: SkillActorDecisionTrace
  workspaceId: string
  roomId: string
  runId: string
  createdAt: string
}): SkillActorMemoryRecord[] {
  return (args.decision.stateUpdates ?? []).flatMap((update): SkillActorMemoryRecord[] => {
    const field = update.field.trim()
    const value = update.value.trim()
    if (!field || !value) {
      return []
    }

    return [{
      schemaVersion: 1,
      workspaceId: args.workspaceId,
      roomId: args.roomId,
      runId: args.runId,
      planIndex: args.decision.planIndex,
      skillId: args.decision.author.id,
      skillName: args.decision.author.name,
      handle: args.decision.author.handle,
      field,
      value,
      sourceDecision: args.decision.decision,
      targetKind: args.decision.target?.kind,
      targetMomentId: args.decision.target?.momentId,
      targetCritiqueId: args.decision.target?.critiqueId,
      sourceReason: args.decision.reason,
      createdAt: args.createdAt,
    }]
  })
}

export function selectSkillActorMemoryRecords(args: {
  records: SkillActorMemoryRecord[]
  roomId: string
  skill: SkillActorSkillInput
  maxRecords?: number
}): SkillActorMemoryRecord[] {
  const latestByField = new Map<string, { record: SkillActorMemoryRecord; index: number }>()

  args.records.forEach((record, index) => {
    if (record.roomId !== args.roomId || !matchesSkill(record, args.skill)) {
      return
    }
    const fieldKey = normalizeKey(stringField(record.field))
    if (!fieldKey || !stringField(record.value)) {
      return
    }
    latestByField.set(fieldKey, { record, index })
  })

  return Array.from(latestByField.values())
    .sort((a, b) => {
      const byTime = b.record.createdAt.localeCompare(a.record.createdAt)
      return byTime || b.index - a.index
    })
    .slice(0, args.maxRecords ?? 12)
    .map((entry) => entry.record)
}

export function renderSkillActorMemory(records: SkillActorMemoryRecord[]): string {
  if (records.length === 0) {
    return '- none'
  }

  return records
    .map((record) => {
      const source = record.sourceDecision === 'reject' ? 'rejected decision' : record.sourceDecision
      return `- ${stringField(record.field)}: ${compactMemoryText(stringField(record.value))} (from ${source}, ${stringField(record.createdAt) || 'unknown time'})`
    })
    .join('\n')
}
