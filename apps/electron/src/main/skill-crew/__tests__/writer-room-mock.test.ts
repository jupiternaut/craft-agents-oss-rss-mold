import { describe, expect, it } from 'bun:test'

import {
  buildWriterRoomMomentPlans,
  WRITER_ROOM_MOCK_PHASES,
  writerArtifactTag,
} from '../writer-room-mock'

const skill = (id: string) => ({
  id,
  name: id,
  handle: `@${id}`,
})

describe('writer-room mock cycle helpers', () => {
  it('produces the required screenplay artifact tag sequence', () => {
    const tags = WRITER_ROOM_MOCK_PHASES.map(writerArtifactTag)

    expect(tags).toEqual([
      'writer_artifact:series_bible',
      'writer_artifact:character_bible',
      'writer_artifact:episode_outline',
      'writer_artifact:scene_card',
      'writer_artifact:dialogue_draft',
      'writer_artifact:continuity_report',
    ])
  })

  it('prefers writer-room skills when planning mock moments', () => {
    const plans = buildWriterRoomMomentPlans(
      [
        skill('hayek'),
        skill('continuity'),
        skill('showrunner'),
        skill('dialogue'),
      ],
      [skill('fallback')],
      6,
    )

    expect(plans.map((plan) => plan.artifactKind)).toEqual(WRITER_ROOM_MOCK_PHASES)
    expect(plans[0]!.author.id).toBe('showrunner')
    expect(plans[3]!.author.id).toBe('showrunner')
    expect(plans[4]!.author.id).toBe('dialogue')
    expect(plans[5]!.author.id).toBe('continuity')
  })
})
