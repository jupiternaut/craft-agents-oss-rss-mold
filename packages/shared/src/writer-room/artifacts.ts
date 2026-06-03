import type { WriterRoomPhase } from './phases.ts';

export const WRITER_ARTIFACT_KINDS = [
  'project_brief',
  'series_bible',
  'character_bible',
  'episode_outline',
  'beat_sheet',
  'scene_card',
  'dialogue_draft',
  'continuity_report',
  'rewrite_task',
  'fountain_script',
] as const satisfies readonly WriterRoomPhase[];

export type WriterArtifactKind = typeof WRITER_ARTIFACT_KINDS[number];

export type WriterArtifactRef = {
  id: string;
  kind: WriterArtifactKind;
  phase: WriterRoomPhase;
  title: string;
  summary?: string;
  path?: string;
  createdAt: string;
  skillId?: string;
  skillName?: string;
};
