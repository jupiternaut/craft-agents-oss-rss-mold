import { describe, expect, it } from 'bun:test'

import type { SkillMomentShowEvaluation } from '../../../shared/types'
import {
  applySkillMomentShowFeedbackCalibration,
  buildSkillMomentShowFeedbackCalibration,
} from '../show-score-calibration'

function baseEvaluation(score: number): SkillMomentShowEvaluation {
  const metric = {
    score: 0.5,
    summary: 'test metric',
    evidence: [],
  }
  return {
    schemaVersion: 1,
    overallScore: score,
    repetition: metric,
    conflictStrength: metric,
    visuality: metric,
    actorParticipation: metric,
    mediaMissingRisk: metric,
    notes: ['base heuristic'],
  }
}

describe('skill moment show score feedback calibration', () => {
  it('raises showScore when recent room feedback trends toward evolution', () => {
    const calibration = buildSkillMomentShowFeedbackCalibration({
      baseScore: 0.5,
      roomId: 'debate',
      feedbackRecords: [
        { roomId: 'debate', verdict: 1, recordedAt: '2026-06-04T01:00:00.000Z' },
        { roomId: 'debate', verdict: 1, recordedAt: '2026-06-04T01:01:00.000Z' },
        { roomId: 'debate', verdict: 2, recordedAt: '2026-06-04T01:02:00.000Z' },
        { roomId: 'screenplay', verdict: 3, recordedAt: '2026-06-04T01:03:00.000Z' },
      ],
    })
    const adjusted = applySkillMomentShowFeedbackCalibration(baseEvaluation(0.5), calibration)

    expect(calibration.counts).toEqual({
      evolve: 2,
      unchanged: 1,
      regress: 0,
      total: 3,
    })
    expect(calibration.adjustment).toBeGreaterThan(0)
    expect(adjusted.overallScore).toBeGreaterThan(0.5)
    expect(adjusted.feedbackCalibration?.reason).toContain('进化')
  })

  it('lowers showScore when recent room feedback trends toward regression', () => {
    const calibration = buildSkillMomentShowFeedbackCalibration({
      baseScore: 0.5,
      roomId: 'debate',
      feedbackRecords: [
        { roomId: 'debate', verdict: 3, recordedAt: '2026-06-04T01:00:00.000Z' },
        { roomId: 'debate', verdict: 3, recordedAt: '2026-06-04T01:01:00.000Z' },
        { roomId: 'debate', verdict: 2, recordedAt: '2026-06-04T01:02:00.000Z' },
      ],
    })
    const adjusted = applySkillMomentShowFeedbackCalibration(baseEvaluation(0.5), calibration)

    expect(calibration.counts.regress).toBe(2)
    expect(calibration.adjustment).toBeLessThan(0)
    expect(adjusted.overallScore).toBeLessThan(0.5)
    expect(adjusted.feedbackCalibration?.reason).toContain('退化')
  })

  it('keeps the heuristic score unchanged when there is no matching feedback', () => {
    const calibration = buildSkillMomentShowFeedbackCalibration({
      baseScore: 0.5,
      roomId: 'debate',
      feedbackRecords: [
        { roomId: 'screenplay', verdict: 1, recordedAt: '2026-06-04T01:00:00.000Z' },
      ],
    })
    const adjusted = applySkillMomentShowFeedbackCalibration(baseEvaluation(0.5), calibration)

    expect(calibration.counts.total).toBe(0)
    expect(calibration.adjustment).toBe(0)
    expect(adjusted.overallScore).toBe(0.5)
    expect(adjusted.feedbackCalibration?.reason).toContain('暂无 debate 房间观众反馈')
  })
})
