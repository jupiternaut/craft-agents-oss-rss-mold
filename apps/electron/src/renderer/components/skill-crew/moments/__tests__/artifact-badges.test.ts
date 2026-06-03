import { describe, expect, it } from 'bun:test'

import {
  formatArtifactBadge,
  isWriterArtifactTag,
} from '../artifact-badges'

describe('artifact badges', () => {
  it('formats writer artifact tags as readable phase labels', () => {
    expect(isWriterArtifactTag('writer_artifact:scene_card')).toBe(true)
    expect(formatArtifactBadge('writer_artifact:scene_card')).toBe('scene_card')
  })

  it('leaves non-writer artifacts unchanged', () => {
    expect(isWriterArtifactTag('agentos_mock_moment')).toBe(false)
    expect(formatArtifactBadge('agentos_mock_moment')).toBe('agentos_mock_moment')
  })
})
