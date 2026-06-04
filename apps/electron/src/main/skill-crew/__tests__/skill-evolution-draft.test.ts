import { describe, expect, it } from 'bun:test'
import type { SkillMomentEvolutionCandidate } from '@craft-agent/shared/skill-moments'

import {
  buildDeterministicSkillEvolutionDraft,
  buildSkillEngineerDraftsFromPendingCandidates,
  buildSkillEngineerDraftPromptFromPendingCandidates,
  buildSkillEvolutionDraftPrompt,
  type SkillEvolutionCandidateInput,
} from '../skill-evolution-draft'

const homelander = {
  id: 'homelander',
  name: 'Homelander',
  handle: '@homelander',
}

describe('skill evolution draft', () => {
  it('turns promote candidates into reinforce delta drafts', () => {
    const [draft] = buildDeterministicSkillEvolutionDraft([
      candidate({
        candidateId: 'candidate-promote-1',
        proposedInstructionDelta: {
          kind: 'reinforce',
          summary: 'Reinforce accepted moment behavior for @homelander.',
          instructionHint: 'Preserve public pressure beats that force Butcher to answer on camera.',
        },
        positiveEvidence: [{
          verdict: 1,
          recordedAt: '2026-06-04T00:00:00.000Z',
          response: 'Turn the city screen into a public accountability trap.',
          sourceLinks: ['https://example.test/source-a'],
        }],
      }),
    ])

    expect(draft).toMatchObject({
      schemaVersion: 1,
      source: 'debt.skill-moments.skill-engineer-draft',
      targetSkill: homelander,
      candidateIds: ['candidate-promote-1'],
      doesNotAutoApply: true,
    })
    expect(draft!.positiveEvidence).toHaveLength(1)
    expect(draft!.regressionEvidence).toHaveLength(0)
    expect(draft!.proposedDeltaMarkdown).toContain('## Reinforce')
    expect(draft!.proposedDeltaMarkdown).toContain(
      '<!-- Review-only Skill Moments draft. Human approval is required before editing SKILL.md. -->',
    )
    expect(draft!.proposedDeltaMarkdown).toContain('Preserve public pressure beats')
    expect(draft!.proposedDeltaMarkdown).toContain('doesNotAutoApply: true')
    expect(draft!.proposedDeltaMarkdown).toContain(
      'This is a delta draft only; do not write SKILL.md from this module.',
    )
  })

  it('turns regress candidates into guardrail delta drafts', () => {
    const [draft] = buildDeterministicSkillEvolutionDraft([
      candidate({
        candidateId: 'candidate-regress-1',
        target: {
          kind: 'critique',
          roomId: 'debate',
          momentId: 'moment-1',
          critiqueId: 'critique-1',
        },
        proposedInstructionDelta: {
          kind: 'guardrail',
          summary: 'Add a guardrail against low-value critique behavior for @homelander.',
          instructionHint: 'Avoid generic acknowledgements that do not advance the room conflict.',
        },
        regressionEvidence: [{
          verdict: 3,
          recordedAt: '2026-06-04T00:01:00.000Z',
          response: 'Received. Continue watching.',
          sourceLinks: ['https://example.test/source-b'],
        }],
      }),
    ])

    expect(draft!.positiveEvidence).toHaveLength(0)
    expect(draft!.regressionEvidence).toHaveLength(1)
    expect(draft!.proposedDeltaMarkdown).toContain('## Guardrails')
    expect(draft!.proposedDeltaMarkdown).toContain('Avoid generic acknowledgements')
    expect(draft!.proposedDeltaMarkdown).toContain('critique=critique-1')
  })

  it('keeps mixed evidence and source links for the target skill', () => {
    const [draft] = buildDeterministicSkillEvolutionDraft([
      candidate({
        candidateId: 'candidate-promote-1',
        proposedInstructionDelta: {
          kind: 'reinforce',
          instructionHint: 'Keep specific public stakes in source posts.',
        },
        positiveEvidence: [{
          verdict: 1,
          recordedAt: '2026-06-04T00:00:00.000Z',
          response: 'A concrete public deadline makes the post feel actionable.',
          sourceLinks: ['https://example.test/promote-a', 'https://example.test/promote-b'],
        }],
      }),
      candidate({
        candidateId: 'candidate-regress-1',
        proposedInstructionDelta: {
          kind: 'guardrail',
          instructionHint: 'Reject filler replies that only acknowledge the room.',
        },
        regressionEvidence: [{
          verdict: 3,
          recordedAt: '2026-06-04T00:02:00.000Z',
          response: 'Noted. I will keep monitoring.',
          sourceLinks: ['https://example.test/regress-a'],
        }],
      }),
    ])

    expect(draft!.candidateIds).toEqual(['candidate-promote-1', 'candidate-regress-1'])
    expect(draft!.positiveEvidence[0]!.sourceLinks).toEqual([
      'https://example.test/promote-a',
      'https://example.test/promote-b',
    ])
    expect(draft!.regressionEvidence[0]!.sourceLinks).toEqual(['https://example.test/regress-a'])
    expect(draft!.proposedDeltaMarkdown).toContain('https://example.test/promote-a')
    expect(draft!.proposedDeltaMarkdown).toContain('https://example.test/regress-a')
  })

  it('builds a review prompt without applying the draft', () => {
    const prompt = buildSkillEvolutionDraftPrompt([
      candidate({
        candidateId: 'candidate-promote-1',
        proposedInstructionDelta: {
          kind: 'reinforce',
          instructionHint: 'Keep concrete stakes.',
        },
        positiveEvidence: [{
          verdict: 1,
          response: 'A concrete public deadline makes the post feel actionable.',
          sourceLinks: [],
        }],
      }),
    ], '# Existing Skill')

    expect(prompt).toContain('Do not call a real LLM')
    expect(prompt).toContain('Do not write SKILL.md')
    expect(prompt).toContain('# Existing Skill')
    expect(prompt).toContain('doesNotAutoApply: true')
  })

  it('builds skill-engineer drafts from pending candidates only', () => {
    const pending = evolutionCandidate({
      candidateId: 'candidate-pending-1',
      status: 'pending_review',
      proposedInstructionDelta: {
        kind: 'reinforce',
        summary: 'Keep public pressure beats.',
        instructionHint: 'Make public posts force a named rival to answer.',
      },
    })
    const accepted = evolutionCandidate({
      candidateId: 'candidate-accepted-1',
      status: 'accepted',
      proposedInstructionDelta: {
        kind: 'guardrail',
        summary: 'Already reviewed.',
        instructionHint: 'Do not include reviewed candidates in the next draft batch.',
      },
    })

    const drafts = buildSkillEngineerDraftsFromPendingCandidates([pending, accepted])
    const prompt = buildSkillEngineerDraftPromptFromPendingCandidates([pending, accepted], '# Existing Skill')

    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.candidateIds).toEqual(['candidate-pending-1'])
    expect(drafts[0]!.proposedDeltaMarkdown).toContain('Make public posts force a named rival')
    expect(drafts[0]!.proposedDeltaMarkdown).not.toContain('candidate-accepted-1')
    expect(prompt).toContain('candidate-pending-1')
    expect(prompt).not.toContain('candidate-accepted-1')
  })
})

function candidate(overrides: Partial<SkillEvolutionCandidateInput>): SkillEvolutionCandidateInput {
  return {
    candidateId: 'candidate-1',
    status: 'pending_review',
    roomId: 'debate',
    skill: homelander,
    target: {
      kind: 'moment',
      roomId: 'debate',
      momentId: 'moment-1',
    },
    proposedInstructionDelta: {
      kind: 'reinforce',
      instructionHint: 'Keep the accepted pattern.',
    },
    positiveEvidence: [],
    regressionEvidence: [],
    doesNotAutoApply: true,
    ...overrides,
  }
}

function evolutionCandidate(
  overrides: Partial<SkillMomentEvolutionCandidate>,
): SkillMomentEvolutionCandidate {
  return {
    schemaVersion: 1,
    source: 'debt.skill-moments.feedback',
    status: 'pending_review',
    candidateId: 'candidate-1',
    createdAt: '2026-06-04T00:00:00.000Z',
    roomId: 'debate',
    skill: homelander,
    target: {
      kind: 'moment',
      roomId: 'debate',
      momentId: 'moment-1',
    },
    proposedInstructionDelta: {
      kind: 'reinforce',
      summary: 'Keep the accepted pattern.',
      instructionHint: 'Keep the accepted pattern.',
    },
    positiveEvidence: [{
      verdict: 1,
      recordedAt: '2026-06-04T00:00:00.000Z',
      response: 'A concrete public deadline makes the post feel actionable.',
      sourceLinks: [],
    }],
    regressionEvidence: [],
    neutralEvidenceCount: 0,
    doesNotAutoApply: true,
    ...overrides,
  }
}
