import { describe, expect, it } from 'bun:test'

import {
  getHomelanderFallenGodScenePack,
  isHomelanderFallenGodExcludedParticipant,
  selectHomelanderFallenGodCriticSlugs,
  selectHomelanderFallenGodMoment,
} from '../index'

describe('homelander fallen god scene pack', () => {
  it('loads the runtime-ready pack and selects a Homelander scene moment with artifacts', () => {
    const scenePack = getHomelanderFallenGodScenePack()
    const selection = selectHomelanderFallenGodMoment('runtime-ready-scene-pack-test', 0)

    expect(scenePack.kind).toBe('skill_moments_scene_pack')
    expect(scenePack.id).toBe('homelander-fallen-god')
    expect(scenePack.status).toBe('runtime_ready')
    expect(selection.scenePackId).toBe('homelander-fallen-god')
    expect(scenePack.beats.map((beat) => beat.id)).toContain(selection.beat.id)
    expect(selection.beat.postTemplates.map((template) => template.id)).toContain(selection.template.id)
    expect(selection.artifacts).toContain('scene_pack:homelander-fallen-god')
    expect(selection.artifacts).toContain(`beat:${selection.beat.id}`)
    expect(selection.artifacts).toContain('persona_scene_moment')
  })

  it('caps critic slug selection, allows silence, and excludes skillcreator', () => {
    const beat = selectHomelanderFallenGodMoment('critic-selection-scene-pack-test', 0).beat
    const availableSlugs = [
      'skillcreator',
      'butcher',
      'dongbei-yujie',
      'gazi',
      'liu-haizhu',
      'chomsky',
      'hayek',
    ]

    const selected = selectHomelanderFallenGodCriticSlugs({
      availableSlugs,
      beat,
      seed: 'scene-pack-test',
      maxCritics: 2,
    })

    expect(selected).toHaveLength(2)
    expect(selected).not.toContain('skillcreator')
    expect(selected.every((slug) => availableSlugs.includes(slug))).toBe(true)
    expect(isHomelanderFallenGodExcludedParticipant('skillcreator')).toBe(true)

    expect(selectHomelanderFallenGodCriticSlugs({
      availableSlugs,
      beat,
      seed: 'scene-pack-test',
      maxCritics: 0,
    })).toEqual([])

    expect(selectHomelanderFallenGodCriticSlugs({
      availableSlugs: ['skillcreator'],
      beat,
      seed: 'scene-pack-test',
      maxCritics: 4,
    })).toEqual([])
  })
})
