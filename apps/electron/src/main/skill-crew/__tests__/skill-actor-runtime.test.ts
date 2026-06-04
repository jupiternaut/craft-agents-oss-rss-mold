import { describe, expect, it } from 'bun:test'

import {
  extractSkillActorCapsule,
  judgeSkillActorDecision,
  loadSkillActorCapsule,
  normalizeSkillActorDecision,
  parseSkillActorDecisionOutput,
  renderSkillActorDecisionSchema,
  type SkillActorDecision,
  type SkillActorSkillInput,
} from '../skill-actor-runtime'

const homelander: SkillActorSkillInput = {
  id: 'homelander',
  name: '祖国人',
  handle: '@homelander',
}

describe('skill actor runtime', () => {
  it('extracts a lightweight actor capsule from SKILL.md sections and labels', () => {
    const capsule = extractSkillActorCapsule([
      '# 祖国人',
      '',
      'Persona: Vought 的公众神像，控制欲强，害怕失去镜头。',
      '',
      '## Responsibilities',
      '- 制造公开议程',
      '- 逼迫对手在镜头前表态',
      '',
      '## Speak When',
      '- 有人挑战 Vought 叙事',
      '',
      '## Stay Silent When',
      '- 只有礼貌寒暄，没有冲突或证据',
      '',
      '## Output Contract',
      '- 输出一个可进入朋友圈的动作场景',
      '',
      '## Relationships',
      '- Butcher 是必须公开羞辱的敌人',
    ].join('\n'))

    expect(capsule.persona).toContain('Vought 的公众神像')
    expect(capsule.responsibilities.join('\n')).toContain('制造公开议程')
    expect(capsule.speakWhen.join('\n')).toContain('有人挑战 Vought 叙事')
    expect(capsule.staySilentWhen.join('\n')).toContain('只有礼貌寒暄')
    expect(capsule.outputContract.join('\n')).toContain('朋友圈')
    expect(capsule.relationships.join('\n')).toContain('Butcher')
    expect(capsule.summary).toContain('祖国人')
  })

  it('falls back to the source summary when capsule fields are missing', () => {
    const capsule = loadSkillActorCapsule({
      slug: 'minimal',
      name: 'Minimal',
      description: '',
      path: '/workspace/skills/minimal/SKILL.md',
      content: '你是一个只在能补充真实推进时才说话的角色。不要输出空洞赞同。',
    })

    expect(capsule.persona).toContain('只在能补充真实推进时才说话')
    expect(capsule.responsibilities).toEqual([capsule.summary])
    expect(capsule.relationships).toEqual([capsule.summary])
  })

  it('normalizes raw and fenced JSON model decisions', () => {
    const fenced = parseSkillActorDecisionOutput([
      '```json',
      '{',
      '  "decision": "critique",',
      '  "body": "这条朋友圈有动作，但还缺少谁会因此被迫站队。",',
      '  "reason": "adds a concrete pressure point",',
      '  "artifact_kind": "scene_card"',
      '}',
      '```',
    ].join('\n'))

    expect(fenced.kind).toBe('publish')
    if (fenced.kind !== 'publish') throw new Error('expected publish')
    expect(fenced.decision.decision).toBe('critique')
    expect(fenced.body).toContain('被迫站队')
    expect(fenced.decision.artifactKind).toBe('scene_card')

    const raw = parseSkillActorDecisionOutput('{"decision":"media_request","body":"今晚塔楼大屏不播声明，播名单。Butcher 要证据，就来镜头前拿。","mediaPrompt":"Homelander on a Vought tower screen under harsh news lights","stateUpdates":{"needsImage":true}}')

    expect(raw.kind).toBe('publish')
    if (raw.kind !== 'publish') throw new Error('expected publish')
    expect(raw.decision.decision).toBe('media_request')
    expect(raw.mediaPrompt).toContain('Vought tower')
    expect(raw.stateUpdates).toEqual([{ field: 'needsImage', value: 'true' }])
  })

  it('supports silence markers and rejects too-short parsed bodies', () => {
    const silence = parseSkillActorDecisionOutput('<SILENCE/>')
    expect(silence.kind).toBe('silence')

    const tooShort = parseSkillActorDecisionOutput('赞同')
    expect(tooShort.kind).toBe('reject')
    if (tooShort.kind !== 'reject') throw new Error('expected reject')
    expect(tooShort.reason).toBe('too-short body')
  })

  it('normalizes decision-like objects before model text parsing', () => {
    const decision = normalizeSkillActorDecision({
      mediaPrompt: 'A phone photo of Butcher holding a redacted Vought list',
    })

    expect(decision?.decision).toBe('media_request')
    expect(decision?.mediaPrompt).toBe('A phone photo of Butcher holding a redacted Vought list')
  })

  it('judges invalid decisions with stable rejection reasons', () => {
    const cases: Array<[SkillActorDecision, string]> = [
      [{ decision: 'speak', body: '' }, 'empty body'],
      [{ decision: 'speak', body: '短句' }, 'too-short body'],
      [{ decision: 'speak', body: '我回来了，这一次所有人都得重新看着我的镜头。' }, 'repeated comeback line'],
      [{ decision: 'critique', body: '点赞！！！' }, 'low-value praise'],
      [{ decision: 'media_request', body: '这条主贴已经有动作，但图片提示词还没有给出来。' }, 'missing mediaPrompt'],
    ]

    for (const [decision, reason] of cases) {
      const judgment = judgeSkillActorDecision({ decision, author: homelander })
      expect(judgment.keep).toBe(false)
      expect(judgment.reason).toBe(reason)
    }
  })

  it('accepts useful speak, critique, and media request decisions', () => {
    expect(judgeSkillActorDecision({
      decision: {
        decision: 'speak',
        body: '我把 Vought 删除的名单投到塔楼大屏，逼 Butcher 当着记者说清楚证据从哪来。',
      },
    }).keep).toBe(true)

    expect(judgeSkillActorDecision({
      decision: {
        decision: 'critique',
        body: '这条有冲突，但还需要一个被迫选边的人站到镜头前。',
      },
    }).keep).toBe(true)

    expect(judgeSkillActorDecision({
      decision: {
        decision: 'media_request',
        body: '我把 Vought 删除的名单投到塔楼大屏，逼 Butcher 当着记者说清楚证据从哪来。',
        mediaPrompt: 'A Vought crisis press room with Homelander facing hostile cameras',
      },
    }).keep).toBe(true)
  })

  it('renders the structured decision schema for prompt wiring', () => {
    expect(renderSkillActorDecisionSchema()).toContain('"decision": "speak" | "silence" | "media_request" | "critique"')
    expect(renderSkillActorDecisionSchema()).toContain('state_updates')
  })
})
