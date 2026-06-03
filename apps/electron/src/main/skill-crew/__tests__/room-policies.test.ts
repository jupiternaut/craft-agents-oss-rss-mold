import { describe, expect, it } from 'bun:test'

import {
  getSkillCrewRoomPolicy,
  isSkillSilenceText,
} from '../room-policies'

const skill = (id: string) => ({
  id,
  name: id,
  handle: `@${id}`,
})

describe('skill crew room policies', () => {
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
})
