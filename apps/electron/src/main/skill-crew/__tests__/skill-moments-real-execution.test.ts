import { describe, expect, it } from 'bun:test'

import type { SkillMomentSkillInput, SkillMomentSourceDigest } from '../../../shared/types'
import {
  buildSkillMomentRealPrompt,
  executeRealSkillMomentCritiquePlans,
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
      actorMemory: [{
        schemaVersion: 1,
        workspaceId: 'workspace-1',
        roomId: 'screenplay',
        runId: 'run-previous',
        planIndex: 0,
        skillId: 'screenwriter',
        skillName: 'screenwriter',
        handle: '@screenwriter',
        field: 'current_goal',
        value: 'force the antagonist to answer in public',
        sourceDecision: 'speak',
        createdAt: '2026-06-03T00:00:02.000Z',
      }],
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
    expect(prompt).toContain('<ACTOR_MEMORY>')
    expect(prompt).toContain('current_goal: force the antagonist to answer in public')
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

  it('keeps actor state updates from structured silence decisions', async () => {
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
        text: JSON.stringify({
          decision: 'silence',
          reason: 'waiting for antagonist escalation',
          state_updates: {
            cooldown_hint: 'stay quiet until Butcher posts evidence',
          },
        }),
      }),
    })

    expect(result.publications).toHaveLength(0)
    expect(result.decisions).toHaveLength(1)
    expect(result.decisions[0]!.decision).toBe('silence')
    expect(result.decisions[0]!.stateUpdates).toEqual([
      { field: 'cooldown_hint', value: 'stay quiet until Butcher posts evidence' },
    ])
  })

  it('records a reject decision trace when SKILL.md instruction is missing', async () => {
    const result = await executeRealSkillMomentPlans({
      plans: [{ author: skill('missing-skill') }],
      instructions: [],
      roomId: 'debate',
      sourceDigests: [digest],
      recentMoments: [],
      recentCritiques: [],
      silencePolicy: 'Return <SILENCE/> when quiet.',
      executor: async () => ({ success: true, text: 'should not run' }),
    })

    expect(result.available).toBe(false)
    expect(result.publications).toHaveLength(0)
    expect(result.decisions).toHaveLength(1)
    expect(result.decisions[0]!.decision).toBe('reject')
    expect(result.decisions[0]!.reason).toContain('Missing SKILL.md')
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

  it('creates one moment publication from a structured actor decision', async () => {
    let capturedPrompt = ''
    const result = await executeRealSkillMomentPlans({
      plans: [{ author: skill('homelander') }],
      instructions: [instruction('homelander')],
      roomId: 'debate',
      sourceDigests: [digest],
      actorMemoryRecords: [{
        schemaVersion: 1,
        workspaceId: 'workspace-1',
        roomId: 'debate',
        runId: 'run-previous',
        planIndex: 0,
        skillId: 'homelander',
        skillName: 'homelander',
        handle: '@homelander',
        field: 'relationship.@butcher',
        value: 'public enemy; make him show evidence on camera',
        sourceDecision: 'speak',
        createdAt: '2026-06-03T00:00:00.000Z',
      }],
      recentMoments: [],
      recentCritiques: [],
      silencePolicy: 'Return <SILENCE/> when quiet.',
      executor: async ({ prompt }) => {
        capturedPrompt = prompt
        return {
          success: true,
          text: JSON.stringify({
            decision: 'media_request',
            body: '今晚塔楼大屏不播声明，播名单。Butcher 要证据，就来镜头前拿。',
            reason: 'public challenge needs an image',
            media_prompt: 'city tower plaza, giant screen, phones raised, theatrical public confrontation',
            state_updates: [{ field: 'last_claim', value: 'challenged Butcher to produce evidence' }],
          }),
        }
      },
    })

    expect(result.available).toBe(true)
    expect(capturedPrompt).toContain('relationship.@butcher: public enemy')
    expect(result.publications).toHaveLength(1)
    expect(result.publications[0]!.decision).toBe('media_request')
    expect(result.publications[0]!.mediaPrompt).toContain('city tower')
    expect(result.publications[0]!.stateUpdates).toEqual([
      { field: 'last_claim', value: 'challenged Butcher to produce evidence' },
    ])
    expect(result.decisions).toHaveLength(1)
    expect(result.decisions[0]!.decision).toBe('media_request')
    expect(result.decisions[0]!.stateUpdates).toEqual([
      { field: 'last_claim', value: 'challenged Butcher to produce evidence' },
    ])
  })

  it('creates one real critique publication with actor memory and state updates', async () => {
    let capturedPrompt = ''
    const result = await executeRealSkillMomentCritiquePlans({
      plans: [{
        parentMomentId: 'moment-1',
        parentAuthor: skill('homelander'),
        parentBody: '今晚塔楼大屏不播声明，播名单。Butcher 要证据，就来镜头前拿。',
        critic: skill('butcher'),
        criticIndex: 0,
      }],
      instructions: [instruction('butcher')],
      roomId: 'debate',
      sourceDigests: [digest],
      actorMemoryRecords: [{
        schemaVersion: 1,
        workspaceId: 'workspace-1',
        roomId: 'debate',
        runId: 'run-previous',
        planIndex: 0,
        skillId: 'butcher',
        skillName: 'butcher',
        handle: '@butcher',
        field: 'relationship.@homelander',
        value: 'wants revenge; demand a name on camera',
        sourceDecision: 'critique',
        createdAt: '2026-06-03T00:00:00.000Z',
      }],
      recentMoments: [],
      recentCritiques: [],
      silencePolicy: 'Return <SILENCE/> when quiet.',
      executor: async ({ prompt }) => {
        capturedPrompt = prompt
        return {
          success: true,
          text: JSON.stringify({
            decision: 'critique',
            body: '你敢放名单，我就敢把第一个名字念出来。猜猜是谁签的字？',
            reason: 'keeps revenge pressure on the parent moment',
            state_updates: [{ field: 'current_goal', value: 'force Homelander to reveal the signer' }],
          }),
        }
      },
    })

    expect(result.available).toBe(true)
    expect(capturedPrompt).toContain('<PARENT_MOMENT>')
    expect(capturedPrompt).toContain('relationship.@homelander: wants revenge')
    expect(result.publications).toHaveLength(1)
    expect(result.publications[0]!.parentMomentId).toBe('moment-1')
    expect(result.publications[0]!.critic.handle).toBe('@butcher')
    expect(result.publications[0]!.body).toContain('第一个名字')
    expect(result.decisions[0]!.target).toEqual({ kind: 'moment', momentId: 'moment-1' })
    expect(result.decisions[0]!.stateUpdates).toEqual([
      { field: 'current_goal', value: 'force Homelander to reveal the signer' },
    ])
  })

  it('keeps real critique silence from creating publications', async () => {
    const result = await executeRealSkillMomentCritiquePlans({
      plans: [{
        parentMomentId: 'moment-1',
        parentAuthor: skill('homelander'),
        parentBody: '今晚塔楼大屏不播声明，播名单。',
        critic: skill('butcher'),
        criticIndex: 0,
      }],
      instructions: [instruction('butcher')],
      roomId: 'debate',
      sourceDigests: [digest],
      recentMoments: [],
      recentCritiques: [],
      silencePolicy: 'Return <SILENCE/> when quiet.',
      executor: async () => ({ success: true, text: '<SILENCE/>' }),
    })

    expect(result.available).toBe(true)
    expect(result.publications).toHaveLength(0)
    expect(result.decisions[0]!.decision).toBe('silence')
  })

  it('keeps screenplay artifact tags on real moments', () => {
    expect(realSkillMomentArtifacts('scene_card')).toEqual([
      'writer_room_real_moment',
      'writer_artifact:scene_card',
    ])
  })
})
