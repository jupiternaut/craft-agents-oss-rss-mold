import { describe, expect, it } from 'bun:test'

import type { SkillMomentSkillInput, SkillMomentSourceDigest } from '../../../shared/types'
import {
  buildSkillMomentRealPrompt,
  executeRealSkillMomentPlans,
  realSkillMomentArtifacts,
  resolveSkillMomentExecutionMode,
  type SkillMomentInstruction,
} from '../skill-moments-real-execution'

const skill = (id: string): SkillMomentSkillInput => ({
  id,
  name: id,
  handle: `@${id}`,
})

const instruction = (slug: string): SkillMomentInstruction => ({
  slug,
  name: slug,
  description: `${slug} test instruction`,
  content: `Act as ${slug}. Publish only when you add concrete screenplay progress.`,
  path: `/workspace/skills/screenplay/${slug}`,
})

const digest: SkillMomentSourceDigest = {
  id: 'digest-1',
  source: 'mock',
  title: 'Source pulse',
  url: 'https://example.test/source',
  summary: 'A source digest summary for the selected skill.',
  capturedAt: '2026-06-03T00:00:00.000Z',
  status: 'mock',
}

describe('skill moments real execution', () => {
  it('keeps mock mode as the default flag value', () => {
    expect(resolveSkillMomentExecutionMode(undefined, undefined)).toBe('mock')
    expect(resolveSkillMomentExecutionMode('mock', 'real')).toBe('mock')
    expect(resolveSkillMomentExecutionMode(undefined, 'real')).toBe('real')
  })

  it('builds prompt context from SKILL.md, room history, critiques, source digests, and phase', () => {
    const prompt = buildSkillMomentRealPrompt({
      skill: skill('screenwriter'),
      instruction: instruction('screenwriter'),
      roomId: 'screenplay',
      phase: 'scene_card',
      recentMoments: [{
        id: 'moment-1',
        roomId: 'screenplay',
        skillId: 'showrunner',
        skillName: 'showrunner',
        handle: '@showrunner',
        body: 'Previous room moment about the ferry terminal.',
        confidence: 'medium',
        createdAt: '2026-06-03T00:00:00.000Z',
        sources: [],
        critiques: [],
      }],
      recentCritiques: [{
        id: 'critique-1',
        parentMomentId: 'moment-1',
        criticSkillId: 'continuity',
        criticSkillName: 'continuity',
        criticHandle: '@continuity',
        body: '她不该知道这件事。',
        createdAt: '2026-06-03T00:00:01.000Z',
      }],
      sourceDigests: [digest],
      silencePolicy: 'Return <SILENCE/> when there is no new artifact progress.',
      browserUse: {
        enabled: true,
        provider: 'brave',
        browserName: 'Brave Browser',
        executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        profileDir: '/Users/tester/.craft-agent/agentos/browser-use/brave-profile',
        remoteDebuggingPort: 9233,
        policy: 'read_only',
      },
    })

    expect(prompt).toContain('<SKILL_MD>')
    expect(prompt).toContain('Act as screenwriter')
    expect(prompt).toContain('roomId: screenplay')
    expect(prompt).toContain('current screenplay phase/artifact: scene_card')
    expect(prompt).toContain('Previous room moment')
    expect(prompt).toContain('她不该知道这件事。')
    expect(prompt).toContain('Source pulse')
    expect(prompt).toContain('Return <SILENCE/>')
    expect(prompt).toContain('<BROWSER_USE>')
    expect(prompt).toContain('browser: Brave Browser')
    expect(prompt).toContain('policy: read_only')
  })

  it('does not create a moment publication for <SILENCE/>', async () => {
    const result = await executeRealSkillMomentPlans({
      plans: [{ author: skill('screenwriter'), artifactKind: 'scene_card' }],
      instructions: [instruction('screenwriter')],
      roomId: 'screenplay',
      sourceDigests: [digest],
      recentMoments: [],
      recentCritiques: [],
      silencePolicy: 'Return <SILENCE/> when quiet.',
      executor: async () => ({ success: true, text: '<SILENCE/>' }),
    })

    expect(result.available).toBe(true)
    expect(result.evaluatedCount).toBe(1)
    expect(result.publications).toHaveLength(0)
  })

  it('creates one moment publication for a valid body', async () => {
    const result = await executeRealSkillMomentPlans({
      plans: [{ author: skill('screenwriter'), artifactKind: 'scene_card' }],
      instructions: [instruction('screenwriter')],
      roomId: 'screenplay',
      sourceDigests: [digest],
      recentMoments: [],
      recentCritiques: [],
      silencePolicy: 'Return <SILENCE/> when quiet.',
      executor: async () => ({
        success: true,
        text: 'Scene card update: Mara enters the ferry terminal with a concrete objective and a visible cost.',
      }),
    })

    expect(result.available).toBe(true)
    expect(result.publications).toHaveLength(1)
    expect(result.publications[0]!.body).toContain('Scene card update')
  })

  it('keeps screenplay artifact tags on real moments', () => {
    expect(realSkillMomentArtifacts('scene_card')).toEqual([
      'writer_room_real_moment',
      'writer_artifact:scene_card',
    ])
  })
})
