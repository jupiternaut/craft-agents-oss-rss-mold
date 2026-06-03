import { describe, expect, it } from 'bun:test';

import {
  WRITER_ARTIFACT_KINDS,
  WRITER_ROOM_ID,
  WRITER_ROOM_PHASES,
  type WriterArtifactRef,
  type WriterRoomRun,
} from '../index.ts';

describe('writer-room types', () => {
  it('keeps artifact kinds aligned with phases', () => {
    expect(WRITER_ARTIFACT_KINDS).toEqual(WRITER_ROOM_PHASES);
  });

  it('accepts a basic writer artifact ref shape', () => {
    const artifact: WriterArtifactRef = {
      id: 'artifact-1',
      kind: 'scene_card',
      phase: 'scene_card',
      title: 'Rooftop confrontation',
      summary: 'A compressed scene card for the mock writer room.',
      createdAt: '2026-06-03T00:00:00.000Z',
      skillId: 'scene',
      skillName: 'scene',
    };

    expect(artifact.kind).toBe('scene_card');
    expect(artifact.phase).toBe('scene_card');
  });

  it('accepts a basic writer room run shape', () => {
    const run: WriterRoomRun = {
      schemaVersion: 1,
      runId: 'run-1',
      workspaceId: 'workspace-1',
      roomId: WRITER_ROOM_ID,
      phase: 'continuity_report',
      startedAt: '2026-06-03T00:00:00.000Z',
      endedAt: '2026-06-03T00:01:00.000Z',
      mode: 'manual_mock',
      artifactCount: 6,
      momentCount: 6,
      criticCount: 10,
      status: 'success',
    };

    expect(run.roomId).toBe('screenplay');
    expect(run.mode).toBe('manual_mock');
    expect(run.artifactCount).toBe(6);
  });
});
