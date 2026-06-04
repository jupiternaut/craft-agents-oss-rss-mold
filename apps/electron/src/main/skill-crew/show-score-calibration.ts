import type {
  SkillFeedbackVerdict,
  SkillMomentFeedbackRecordInput,
  SkillMomentShowEvaluation,
  SkillMomentShowFeedbackCalibration,
} from '../../shared/types'

const DEFAULT_FEEDBACK_SAMPLE_WINDOW = 80
const MAX_FEEDBACK_ADJUSTMENT = 0.15

type FeedbackRecord = Pick<
  SkillMomentFeedbackRecordInput,
  'roomId' | 'verdict' | 'recordedAt'
>

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
}

function clampAdjustment(value: number): number {
  return Math.round(Math.max(-MAX_FEEDBACK_ADJUSTMENT, Math.min(MAX_FEEDBACK_ADJUSTMENT, value)) * 100) / 100
}

function isFeedbackVerdict(value: unknown): value is SkillFeedbackVerdict {
  return value === 1 || value === 2 || value === 3
}

function feedbackSortTime(record: FeedbackRecord): string {
  return record.recordedAt ?? ''
}

function calibrationReason(args: {
  roomId: string
  evolve: number
  unchanged: number
  regress: number
  adjustment: number
}): string {
  const { roomId, evolve, unchanged, regress, adjustment } = args
  const countText = `进化 ${evolve} / 不变 ${unchanged} / 退化 ${regress}`
  if (evolve + unchanged + regress === 0) {
    return `暂无 ${roomId} 房间观众反馈；节目效果分保持启发式基线。`
  }
  if (adjustment > 0) {
    return `观众反馈偏进化，${countText}，在启发式基线上上调 ${Math.round(adjustment * 100)} 分。`
  }
  if (adjustment < 0) {
    return `观众反馈偏退化，${countText}，在启发式基线上下调 ${Math.abs(Math.round(adjustment * 100))} 分。`
  }
  return `观众反馈暂未形成方向，${countText}，节目效果分保持启发式基线。`
}

export function buildSkillMomentShowFeedbackCalibration(args: {
  baseScore: number
  roomId: string
  feedbackRecords: FeedbackRecord[]
  sourcePath?: string
  sampleWindow?: number
}): SkillMomentShowFeedbackCalibration {
  const sampleWindow = Math.min(Math.max(args.sampleWindow ?? DEFAULT_FEEDBACK_SAMPLE_WINDOW, 1), 500)
  const matchingRecords = args.feedbackRecords
    .filter((record) => record.roomId === args.roomId && isFeedbackVerdict(record.verdict))
    .sort((left, right) => feedbackSortTime(right).localeCompare(feedbackSortTime(left)))
    .slice(0, sampleWindow)

  let evolve = 0
  let unchanged = 0
  let regress = 0
  for (const record of matchingRecords) {
    if (record.verdict === 1) evolve += 1
    if (record.verdict === 2) unchanged += 1
    if (record.verdict === 3) regress += 1
  }

  const total = evolve + unchanged + regress
  const signal = total > 0 ? (evolve - regress) / total : 0
  const confidence = total > 0 ? total / (total + 4) : 0
  const adjustment = clampAdjustment(signal * MAX_FEEDBACK_ADJUSTMENT * confidence)
  const baseScore = clampScore(args.baseScore)
  const adjustedScore = clampScore(baseScore + adjustment)

  return {
    schemaVersion: 1,
    method: 'heuristic_feedback_adjustment',
    roomId: args.roomId,
    baseScore,
    adjustedScore,
    adjustment,
    counts: {
      evolve,
      unchanged,
      regress,
      total,
    },
    sampleWindow,
    source: 'skill_moments_feedback_jsonl',
    sourcePath: args.sourcePath,
    latestRecordedAt: matchingRecords[0]?.recordedAt,
    reason: calibrationReason({
      roomId: args.roomId,
      evolve,
      unchanged,
      regress,
      adjustment,
    }),
  }
}

export function applySkillMomentShowFeedbackCalibration(
  evaluation: SkillMomentShowEvaluation,
  calibration: SkillMomentShowFeedbackCalibration,
): SkillMomentShowEvaluation {
  return {
    ...evaluation,
    overallScore: calibration.adjustedScore,
    feedbackCalibration: calibration,
    notes: [
      ...evaluation.notes,
      `feedback calibration: ${calibration.reason}`,
    ],
  }
}
