export const WRITER_ROOM_PHASES = [
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
] as const;

export type WriterRoomPhase = typeof WRITER_ROOM_PHASES[number];
