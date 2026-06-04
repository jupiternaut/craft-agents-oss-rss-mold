import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  appendJsonlRecord,
  listSkillMomentsForWorkspace,
  readJsonlRecords,
  recordSkillMomentFeedbackForWorkspace,
  skillMomentFeedbackPath,
  skillMomentsWorkspaceDir,
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
})
