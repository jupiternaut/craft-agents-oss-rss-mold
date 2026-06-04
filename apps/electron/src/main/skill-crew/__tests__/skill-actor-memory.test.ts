import { describe, expect, it } from 'bun:test'

import {
  buildSkillActorMemoryRecords,
  renderSkillActorMemory,
  selectSkillActorMemoryRecords,
  type SkillActorMemoryRecord,
} from '../skill-actor-memory'

const homelander = {
  id: 'homelander',
  name: '祖国人',
  handle: '@homelander',
}

describe('skill actor memory', () => {
  it('builds durable memory records from actor state updates', () => {
    const records = buildSkillActorMemoryRecords({
      workspaceId: 'workspace-1',
      roomId: 'debate',
      runId: 'run-1',
      createdAt: '2026-06-04T00:00:00.000Z',
      decision: {
        planIndex: 0,
        author: homelander,
        decision: 'speak',
        reason: 'escalates Butcher conflict',
        stateUpdates: [
          { field: 'relationship.@butcher', value: 'public enemy; force him onto camera' },
          { field: 'current_goal', value: 'turn the city screen into a loyalty test' },
          { field: '', value: 'ignored' },
        ],
      },
    })

    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      schemaVersion: 1,
      workspaceId: 'workspace-1',
      roomId: 'debate',
      skillId: 'homelander',
      handle: '@homelander',
      field: 'relationship.@butcher',
      value: 'public enemy; force him onto camera',
      sourceDecision: 'speak',
    })
  })

  it('selects latest same-field memory for the target actor and room', () => {
    const records: SkillActorMemoryRecord[] = [
      record('debate', 'homelander', '@homelander', 'current_goal', 'old goal', '2026-06-04T00:00:00.000Z'),
      record('debate', 'homelander', '@homelander', 'current_goal', 'new goal', '2026-06-04T00:01:00.000Z'),
      record('debate', 'butcher', '@butcher', 'current_goal', 'wrong actor', '2026-06-04T00:02:00.000Z'),
      record('screenplay', 'homelander', '@homelander', 'current_goal', 'wrong room', '2026-06-04T00:03:00.000Z'),
      record('debate', 'homelander', '@homelander', 'relationship.@butcher', 'enemy heat rises', '2026-06-04T00:04:00.000Z'),
    ]

    const selected = selectSkillActorMemoryRecords({
      records,
      roomId: 'debate',
      skill: homelander,
    })

    expect(selected.map((item) => [item.field, item.value])).toEqual([
      ['relationship.@butcher', 'enemy heat rises'],
      ['current_goal', 'new goal'],
    ])
  })

  it('renders an actor memory prompt block', () => {
    expect(renderSkillActorMemory([])).toBe('- none')
    expect(renderSkillActorMemory([
      record('debate', 'homelander', '@homelander', 'current_goal', 'force Butcher to answer publicly', '2026-06-04T00:01:00.000Z'),
    ])).toContain('current_goal: force Butcher to answer publicly')
  })
})

function record(
  roomId: string,
  skillId: string,
  handle: string,
  field: string,
  value: string,
  createdAt: string,
): SkillActorMemoryRecord {
  return {
    schemaVersion: 1,
    workspaceId: 'workspace-1',
    roomId,
    runId: 'run-1',
    planIndex: 0,
    skillId,
    skillName: skillId,
    handle,
    field,
    value,
    sourceDecision: 'speak',
    createdAt,
  }
}
