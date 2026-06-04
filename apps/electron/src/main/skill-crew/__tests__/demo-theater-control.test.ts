import { describe, expect, it } from 'bun:test'

import type { SkillMomentShowFeedbackCalibration, SkillMomentSkillInput } from '../../../shared/types'
import {
  buildSkillMomentActorIntentCards,
  buildSkillMomentDemoContract,
} from '../demo-theater-control'

function skill(id: string, name: string, handle: string): SkillMomentSkillInput {
  return { id, name, handle }
}

function regressionFeedback(): SkillMomentShowFeedbackCalibration {
  return {
    schemaVersion: 1,
    method: 'heuristic_feedback_adjustment',
    roomId: 'debate',
    baseScore: 0.5,
    adjustedScore: 0.35,
    adjustment: -0.15,
    counts: {
      evolve: 0,
      unchanged: 1,
      regress: 3,
      total: 4,
    },
    sampleWindow: 4,
    source: 'skill_moments_feedback_jsonl',
    reason: '退化反馈较多',
  }
}

describe('skill moment demo theater control', () => {
  it('builds a small demo contract with anti-repeat rules and original shell', () => {
    const contract = buildSkillMomentDemoContract({
      roomId: 'debate',
      dramaSchedule: {
        prioritizedActorSlugs: [],
        notes: [],
      },
      mediaEnabled: true,
    })

    expect(contract.title).toBe('AI 角色朋友圈剧场')
    expect(contract.conflict?.publicLabel).toBe('祖国人 vs 屠夫')
    expect(contract.requiredBeats.join('\n')).toContain('死敌必须反击')
    expect(contract.requiredBeats.join('\n')).toContain('图片动作')
    expect(contract.antiRepeatRules.join('\n')).toContain('禁止重复')
    expect(contract.originalShell?.world).toContain('朋友圈')
  })

  it('uses regression feedback to force stronger next-round scheduling', () => {
    const contract = buildSkillMomentDemoContract({
      roomId: 'debate',
      dramaSchedule: {
        prioritizedActorSlugs: [],
        notes: [],
      },
      feedbackCalibration: regressionFeedback(),
    })

    expect(contract.feedbackInfluence).toContain('退化')
    expect(contract.feedbackInfluence).toContain('反击')
  })

  it('turns selected actors into visible intent cards', () => {
    const contract = buildSkillMomentDemoContract({
      roomId: 'debate',
      dramaSchedule: {
        prioritizedActorSlugs: ['homelander', 'butcher'],
        notes: [],
      },
      mediaEnabled: true,
    })
    const cards = buildSkillMomentActorIntentCards({
      skills: [
        skill('homelander', '祖国人', '@homelander'),
        skill('butcher', '屠夫', '@butcher'),
        skill('ashley', '碍事丽', '@ashley'),
      ],
      dramaSchedule: {
        prioritizedActorSlugs: ['homelander', 'butcher'],
        notes: [],
      },
      demoContract: contract,
      mediaEnabled: true,
    })

    expect(cards[0]?.slug).toBe('homelander')
    expect(cards[0]?.nextAction).toContain('点名')
    expect(cards[0]?.mediaIntent).toBe(true)
    expect(cards[1]?.slug).toBe('butcher')
    expect(cards[1]?.visibility).toBe('private')
    expect(cards[1]?.nextAction).toContain('仅可见')
    expect(cards[2]?.role).toContain('公关')
  })
})
