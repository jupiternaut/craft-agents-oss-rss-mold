import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  appendJsonlRecord,
  buildSkillMomentEvolutionCandidates,
  listSkillMomentEvolutionCandidatesForWorkspace,
  listSkillMomentsForWorkspace,
  markSkillMomentEvolutionCandidateReviewedForWorkspace,
  readJsonlRecords,
  recordSkillMomentFeedbackForWorkspace,
  skillMomentEvolutionCandidatePath,
  skillMomentFeedbackPath,
  skillMomentsWorkspaceDir,
  type SkillMomentEvolutionCandidate,
  type StoredSkillMoment,
  type StoredSkillMomentCritique,
} from './storage'

const tempRoots: string[] = []

function makeWorkspace(): string {
  const root = join(tmpdir(), `craft-skill-moments-storage-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(root, { recursive: true })
  tempRoots.push(root)
  return root
}

describe('skill moments storage service', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('lists stored moments with critiques and latest feedback verdicts', async () => {
    const root = makeWorkspace()
    const momentsDir = skillMomentsWorkspaceDir(root)
    const moment: StoredSkillMoment = {
      id: 'moment-1',
      roomId: 'debate',
      skillId: 'homelander',
      skillName: '祖国人',
      handle: '@homelander',
      body: '我把名单贴出来。',
      confidence: 'medium',
      createdAt: '2026-06-04T00:00:00.000Z',
      sources: [],
    }
    const critique: StoredSkillMomentCritique = {
      id: 'critique-1',
      parentMomentId: 'moment-1',
      criticSkillId: 'butcher',
      criticSkillName: '屠夫',
      criticHandle: '@butcher',
      body: '你敢贴，我就敢念。',
      createdAt: '2026-06-04T00:00:01.000Z',
    }

    await appendJsonlRecord(join(momentsDir, 'moments.jsonl'), moment)
    await appendJsonlRecord(join(momentsDir, 'critics.jsonl'), critique)
    await recordSkillMomentFeedbackForWorkspace(root, {
      workspaceId: 'workspace-1',
      roomId: 'debate',
      momentId: 'moment-1',
      critiqueId: 'critique-1',
      skillId: 'butcher',
      skillName: '屠夫',
      handle: '@butcher',
      verdict: 1,
      messageBody: critique.body,
      sources: [{
        id: 'source-1',
        source: 'manual',
        title: 'Vought leaked list',
        url: 'https://example.test/vought-list',
        summary: 'A leaked Vought list enters the room.',
        capturedAt: '2026-06-04T00:00:00.000Z',
        status: 'ready',
      }],
    })

    const result = await listSkillMomentsForWorkspace(root, {
      roomId: 'debate',
      limit: 10,
    })

    expect(result.moments).toHaveLength(1)
    expect(result.moments[0]!.critiques).toHaveLength(1)
    expect(result.moments[0]!.critiques[0]!.feedbackVerdict).toBe(1)
    expect(result.moments[0]!.critiques[0]!.feedbackSavedPath).toContain('skill_moments_feedback.jsonl')

    const records = await readJsonlRecords<Record<string, unknown>>(skillMomentFeedbackPath(root))
    expect(records[0]!.response).toBe(critique.body)
    expect(records[0]!.sourceLinks).toEqual(['https://example.test/vought-list'])
  })

  it('writes review-only evolution candidates for promote and regress feedback', async () => {
    const root = makeWorkspace()
    const promote = await recordSkillMomentFeedbackForWorkspace(root, {
      workspaceId: 'workspace-1',
      roomId: 'debate',
      momentId: 'moment-1',
      skillId: 'homelander',
      skillName: '祖国人',
      handle: '@homelander',
      verdict: 1,
      messageBody: '把城市大屏变成公开审判，逼 Butcher 到镜头前。',
      recordedAt: '2026-06-04T00:00:00.000Z',
    })
    const regress = await recordSkillMomentFeedbackForWorkspace(root, {
      workspaceId: 'workspace-1',
      roomId: 'debate',
      momentId: 'moment-1',
      critiqueId: 'critique-1',
      skillId: 'butcher',
      skillName: '屠夫',
      handle: '@butcher',
      verdict: 3,
      messageBody: '收到，继续观察。',
      recordedAt: '2026-06-04T00:01:00.000Z',
    })
    const unchanged = await recordSkillMomentFeedbackForWorkspace(root, {
      workspaceId: 'workspace-1',
      roomId: 'debate',
      momentId: 'moment-2',
      skillId: 'ashley',
      skillName: '碍事丽',
      handle: '@ashley',
      verdict: 2,
      messageBody: '所有账号统一口径。',
      recordedAt: '2026-06-04T00:02:00.000Z',
    })

    expect(promote.evolutionCandidatePath).toContain('skill_moments_evolution_candidates.jsonl')
    expect(regress.evolutionCandidatePath).toContain('skill_moments_evolution_candidates.jsonl')
    expect(unchanged.evolutionCandidatePath).toBeUndefined()

    const candidates = await readJsonlRecords<SkillMomentEvolutionCandidate>(skillMomentEvolutionCandidatePath(root))
    expect(candidates).toHaveLength(2)
    expect(candidates.map((candidate) => candidate.status)).toEqual(['pending_review', 'pending_review'])
    expect(candidates.map((candidate) => candidate.source)).toEqual([
      'debt.skill-moments.feedback',
      'debt.skill-moments.feedback',
    ])
    expect(candidates[0]!.positiveEvidence.map((evidence) => evidence.verdict)).toEqual([1])
    expect(candidates[1]!.regressionEvidence.map((evidence) => evidence.verdict)).toEqual([3])
    expect(candidates.map((candidate) => candidate.doesNotAutoApply)).toEqual([true, true])
    expect(candidates[0]!.proposedInstructionDelta.kind).toBe('reinforce')
    expect(candidates[0]!.positiveEvidence[0]!.response).toContain('城市大屏')
    expect(candidates[0]!.doesNotAutoApply).toBe(true)
    expect(candidates[1]!.proposedInstructionDelta.kind).toBe('guardrail')
    expect(candidates[1]!.regressionEvidence[0]!.response).toContain('收到')
  })

  it('lists pending evolution candidates', async () => {
    const root = makeWorkspace()
    await recordSkillMomentFeedbackForWorkspace(root, {
      workspaceId: 'workspace-1',
      roomId: 'debate',
      momentId: 'moment-1',
      skillId: 'homelander',
      skillName: '祖国人',
      handle: '@homelander',
      verdict: 1,
      messageBody: '把城市大屏变成公开审判，逼 Butcher 到镜头前。',
      recordedAt: '2026-06-04T00:00:00.000Z',
    })
    await recordSkillMomentFeedbackForWorkspace(root, {
      workspaceId: 'workspace-1',
      roomId: 'debate',
      momentId: 'moment-2',
      skillId: 'butcher',
      skillName: '屠夫',
      handle: '@butcher',
      verdict: 3,
      messageBody: '收到，继续观察。',
      recordedAt: '2026-06-04T00:01:00.000Z',
    })

    const result = await listSkillMomentEvolutionCandidatesForWorkspace(root, {
      reviewState: 'pending',
      limit: 10,
    })

    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.map((candidate) => candidate.status)).toEqual(['pending_review', 'pending_review'])
    expect(result.candidates[0]!.target.momentId).toBe('moment-2')
  })

  it('marks evolution candidates accepted and rejected as reviewed', async () => {
    const root = makeWorkspace()
    await recordSkillMomentFeedbackForWorkspace(root, {
      workspaceId: 'workspace-1',
      roomId: 'debate',
      momentId: 'moment-1',
      skillId: 'homelander',
      skillName: '祖国人',
      handle: '@homelander',
      verdict: 1,
      messageBody: '把城市大屏变成公开审判，逼 Butcher 到镜头前。',
      recordedAt: '2026-06-04T00:00:00.000Z',
    })
    await recordSkillMomentFeedbackForWorkspace(root, {
      workspaceId: 'workspace-1',
      roomId: 'debate',
      momentId: 'moment-2',
      skillId: 'butcher',
      skillName: '屠夫',
      handle: '@butcher',
      verdict: 3,
      messageBody: '收到，继续观察。',
      recordedAt: '2026-06-04T00:01:00.000Z',
    })
    const pending = await listSkillMomentEvolutionCandidatesForWorkspace(root, {
      reviewState: 'pending',
      limit: 10,
    })
    const acceptedCandidate = pending.candidates.find((candidate) => candidate.target.momentId === 'moment-1')!
    const rejectedCandidate = pending.candidates.find((candidate) => candidate.target.momentId === 'moment-2')!

    const accepted = await markSkillMomentEvolutionCandidateReviewedForWorkspace(root, {
      candidateId: acceptedCandidate.candidateId,
      status: 'accepted',
      reviewedAt: '2026-06-04T00:02:00.000Z',
      reviewedBy: { id: 'reviewer-1', name: 'Reviewer One' },
      reviewNote: 'Keep this pattern.',
    })

    expect(accepted.candidate.status).toBe('accepted')
    expect(accepted.candidate.reviewedBy?.id).toBe('reviewer-1')

    const pendingAfterAccepted = await listSkillMomentEvolutionCandidatesForWorkspace(root, {
      reviewState: 'pending',
      limit: 10,
    })
    const reviewedAfterAccepted = await listSkillMomentEvolutionCandidatesForWorkspace(root, {
      reviewState: 'reviewed',
      limit: 10,
    })

    expect(pendingAfterAccepted.candidates.map((candidate) => candidate.candidateId)).toEqual([
      rejectedCandidate.candidateId,
    ])
    expect(reviewedAfterAccepted.candidates.map((candidate) => candidate.candidateId)).toEqual([
      acceptedCandidate.candidateId,
    ])

    const rejected = await markSkillMomentEvolutionCandidateReviewedForWorkspace(root, {
      candidateId: rejectedCandidate.candidateId,
      status: 'rejected',
      reviewedAt: '2026-06-04T00:03:00.000Z',
      reviewNote: 'Too generic.',
    })

    expect(rejected.candidate.status).toBe('rejected')
    expect(rejected.candidate.reviewNote).toBe('Too generic.')

    const pendingAfterReview = await listSkillMomentEvolutionCandidatesForWorkspace(root, {
      reviewState: 'pending',
      limit: 10,
    })
    const reviewed = await listSkillMomentEvolutionCandidatesForWorkspace(root, {
      reviewState: 'reviewed',
      limit: 10,
    })

    expect(pendingAfterReview.candidates).toHaveLength(0)
    expect(reviewed.candidates.map((candidate) => [candidate.candidateId, candidate.status])).toEqual([
      [rejectedCandidate.candidateId, 'rejected'],
      [acceptedCandidate.candidateId, 'accepted'],
    ])
  })

  it('uses the latest state for each evolution candidate id', async () => {
    const root = makeWorkspace()
    await recordSkillMomentFeedbackForWorkspace(root, {
      workspaceId: 'workspace-1',
      roomId: 'debate',
      momentId: 'moment-1',
      skillId: 'homelander',
      skillName: '祖国人',
      handle: '@homelander',
      verdict: 1,
      messageBody: '把城市大屏变成公开审判，逼 Butcher 到镜头前。',
      recordedAt: '2026-06-04T00:00:00.000Z',
    })
    const pending = await listSkillMomentEvolutionCandidatesForWorkspace(root, {
      reviewState: 'pending',
      limit: 10,
    })
    const candidateId = pending.candidates[0]!.candidateId

    await markSkillMomentEvolutionCandidateReviewedForWorkspace(root, {
      candidateId,
      status: 'accepted',
      reviewedAt: '2026-06-04T00:01:00.000Z',
    })
    await markSkillMomentEvolutionCandidateReviewedForWorkspace(root, {
      candidateId,
      status: 'rejected',
      reviewedAt: '2026-06-04T00:02:00.000Z',
    })

    const reviewed = await listSkillMomentEvolutionCandidatesForWorkspace(root, {
      reviewState: 'reviewed',
      limit: 10,
    })
    const accepted = await listSkillMomentEvolutionCandidatesForWorkspace(root, {
      status: 'accepted',
      limit: 10,
    })
    const rejected = await listSkillMomentEvolutionCandidatesForWorkspace(root, {
      status: 'rejected',
      limit: 10,
    })

    expect(reviewed.candidates).toHaveLength(1)
    expect(reviewed.candidates[0]!.candidateId).toBe(candidateId)
    expect(reviewed.candidates[0]!.status).toBe('rejected')
    expect(reviewed.candidates[0]!.reviewedAt).toBe('2026-06-04T00:02:00.000Z')
    expect(accepted.candidates).toHaveLength(0)
    expect(rejected.candidates).toHaveLength(1)
  })

  it('builds candidate evidence from the latest feedback for each target', () => {
    const candidates = buildSkillMomentEvolutionCandidates([
      {
        workspaceId: 'workspace-1',
        roomId: 'debate',
        momentId: 'moment-1',
        skillId: 'homelander',
        handle: '@homelander',
        verdict: 1,
        messageBody: 'old accepted beat',
        recordedAt: '2026-06-04T00:00:00.000Z',
      },
      {
        workspaceId: 'workspace-1',
        roomId: 'debate',
        momentId: 'moment-1',
        skillId: 'homelander',
        handle: '@homelander',
        verdict: 3,
        messageBody: 'new rejected beat',
        recordedAt: '2026-06-04T00:01:00.000Z',
      },
      {
        workspaceId: 'workspace-1',
        roomId: 'debate',
        momentId: 'moment-2',
        skillId: 'butcher',
        handle: '@butcher',
        verdict: 2,
        messageBody: 'neutral beat',
        recordedAt: '2026-06-04T00:02:00.000Z',
      },
    ])

    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.target.momentId).toBe('moment-1')
    expect(candidates[0]!.proposedInstructionDelta.kind).toBe('guardrail')
    expect(candidates[0]!.regressionEvidence[0]!.response).toBe('new rejected beat')
  })
})
