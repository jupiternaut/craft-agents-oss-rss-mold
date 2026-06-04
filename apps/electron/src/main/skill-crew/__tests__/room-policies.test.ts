import { describe, expect, it } from 'bun:test'

import {
  getSkillCrewRoomPolicy,
  isSkillSilenceText,
  normalizeSkillMomentSlug,
} from '../room-policies'

const skill = (id: string) => ({
  id,
  name: id,
  handle: `@${id}`,
})

describe('skill crew room policies', () => {
  it('normalizes Chinese debate handles and names to canonical slugs', () => {
    const aliases = [
      ['祖国人', 'homelander'],
      ['屠夫', 'butcher'],
      ['东北雨姐', 'dongbei-yujie'],
      ['嘎子', 'gazi'],
      ['刘海柱', 'liu-haizhu'],
    ] as const

    for (const [label, slug] of aliases) {
      expect(normalizeSkillMomentSlug({
        id: `local-${slug}`,
        name: 'Fallback',
        handle: `@${label}`,
      })).toBe(slug)

      expect(normalizeSkillMomentSlug({
        id: '',
        name: label,
        handle: '',
      })).toBe(slug)
    }
  })

  it('excludes utility skills for screenplay auto inclusion', () => {
    const policy = getSkillCrewRoomPolicy('screenplay')

    expect(policy.shouldAutoInclude(skill('skillcreator'))).toBe(false)
    expect(policy.shouldAutoInclude(skill('chairman'))).toBe(false)
    expect(policy.shouldAutoInclude(skill('__chairman__'))).toBe(false)
    expect(policy.shouldAutoInclude(skill('hafuke'))).toBe(false)
    expect(policy.shouldAutoInclude(skill('screenwriter'))).toBe(true)
  })

  it('prioritizes screenplay writer-room skills while preserving fallback order', () => {
    const policy = getSkillCrewRoomPolicy('screenplay')
    const ordered = policy.orderParticipants([
      skill('hayek'),
      skill('continuity'),
      skill('showrunner'),
      skill('dialogue'),
    ])

    expect(ordered.map((item) => item.id)).toEqual([
      'showrunner',
      'dialogue',
      'continuity',
      'hayek',
    ])

    const fallback = policy.orderParticipants([
      skill('hayek'),
      skill('sun'),
    ])
    expect(fallback.map((item) => item.id)).toEqual(['hayek', 'sun'])
  })

  it('orders continuity critics first for screenplay scene work', () => {
    const policy = getSkillCrewRoomPolicy('screenplay')
    const ordered = policy.orderCritics(
      skill('screenwriter'),
      [
        skill('dialogue'),
        skill('showrunner'),
        skill('continuity'),
      ],
      { artifactKind: 'scene_card' },
    )

    expect(ordered.map((item) => item.id)).toEqual([
      'continuity',
      'showrunner',
      'dialogue',
    ])
  })

  it('does not keep silence as persisted moment text', () => {
    const policy = getSkillCrewRoomPolicy('screenplay')

    expect(isSkillSilenceText('<SILENCE/>')).toBe(true)
    expect(policy.shouldKeepMoment(skill('screenwriter'), '<SILENCE/>')).toBe(false)
  })

  it('rejects stale Homelander comeback loops and keeps dramatic action beats', () => {
    const policy = getSkillCrewRoomPolicy('debate')

    expect(policy.shouldKeepMoment(skill('homelander'), [
      '孩子们，我复活了。',
      '别怕，我回来了。你们需要的不是更多解释，是一个能让所有人抬头看的名字。',
    ].join('\n'))).toBe(false)

    expect(policy.shouldKeepMoment(skill('homelander'), [
      '@homelander 朋友圈',
      '九点整，我把城市大屏切成直播，把 Vought 删掉的名单一页页翻出来。',
      'Butcher 说他有证据，那就让他在镜头前选：交出来，还是承认他也怕观众。',
    ].join('\n'))).toBe(true)

    expect(policy.shouldKeepMoment(skill('homelander'), [
      '@homelander 朋友圈',
      '假新闻又把我的笑容裁掉了。很可爱。',
      '今晚八点，Vought 塔楼大屏放原片。Butcher 可以来，也可以继续躲在评论区。',
    ].join('\n'))).toBe(true)

    expect(policy.shouldKeepMoment(skill('homelander'), [
      '@homelander 朋友圈',
      '刚到市政厅门口。台阶很高，记者很多，坏问题也很多。',
      '我会先拍一张照，再告诉他们为什么输家总喜欢把恐惧叫成新闻。',
    ].join('\n'))).toBe(true)
  })

  it('keeps fallen-god object-specific Homelander posts while rejecting comeback filler', () => {
    const policy = getSkillCrewRoomPolicy('debate')

    expect(policy.shouldKeepMoment(skill('homelander'), [
      '@homelander 朋友圈',
      '热狗摊的纸盘很薄，三美元硬币硌着掌心。',
      '他们以为手机能逼神低头，可普通身体的疼只是在提醒我先活过今晚。',
    ].join('\n'))).toBe(true)

    expect(policy.shouldKeepMoment(skill('homelander'), [
      '@homelander 朋友圈',
      '我回来了。',
      '你们需要继续抬头看我，因为我才是唯一正确的答案。',
    ].join('\n'))).toBe(false)
  })

  it('keeps Vought subordinates as Homelander replies instead of source posts', () => {
    const policy = getSkillCrewRoomPolicy('debate')

    for (const id of ['ashley', 'atrain', 'black-noir', 'deep']) {
      expect(policy.shouldKeepMoment(skill(id), [
        `@${id} 朋友圈`,
        '我读到「Polymarket Gamma API: prediction market narrative signal」后的判断：这是一条市场叙事信号。',
      ].join('\n'))).toBe(false)
    }

    expect(policy.shouldKeepCritique(
      skill('homelander'),
      skill('ashley'),
      '所有账号照这一版转：先说城市安全，再说您亲自出面，最后不要提热线是谁接。',
    )).toBe(true)
  })

  it('keeps long Homelander and Butcher debate replies to each other', () => {
    const policy = getSkillCrewRoomPolicy('debate')
    const homelanderToButcher = '屠夫，你拿着证据晃来晃去，是因为你知道一旦镜头打开，所有人都会看见你只剩仇恨，没有方案。'
    const butcherToHomelander = '祖国人，少拿城市当你的舞台布景。你越急着让 Vought 开大屏，我越确定那份名单戳中了你的软肋。'

    expect(Array.from(homelanderToButcher).length).toBeGreaterThan(20)
    expect(Array.from(butcherToHomelander).length).toBeGreaterThan(20)

    expect(policy.shouldKeepCritique(
      skill('butcher'),
      skill('homelander'),
      homelanderToButcher,
    )).toBe(true)
    expect(policy.shouldKeepCritique(
      skill('homelander'),
      skill('butcher'),
      butcherToHomelander,
    )).toBe(true)
  })
})
