import type { WriterArtifactKind, WriterArtifactRef } from './artifacts.ts';
import type { WriterRoomPhase } from './phases.ts';

export type WriterRoomRun = {
  schemaVersion: 1;
  runId: string;
  workspaceId: string;
  roomId: string;
  phase: WriterRoomPhase;
  startedAt: string;
  endedAt?: string;
  mode: 'manual_mock' | 'manual_llm' | 'automation';
  artifactCount: number;
  momentCount: number;
  criticCount: number;
  status: 'success' | 'error';
  errorMessage?: string;
};

export type WriterContinuityIssue = {
  id: string;
  severity: 'info' | 'warning' | 'error';
  issueType:
    | 'character_voice'
    | 'forbidden_knowledge'
    | 'timeline'
    | 'low_conflict'
    | 'missing_subtext'
    | 'format'
    | 'source_gap';
  description: string;
  suggestedFix?: string;
  affectedArtifactId?: string;
};

export type WriterContinuityReport = {
  schemaVersion: 1;
  id: string;
  phase: 'continuity_report';
  passed: boolean;
  issues: WriterContinuityIssue[];
  createdAt: string;
};

export type {
  WriterArtifactKind,
  WriterArtifactRef,
  WriterRoomPhase,
};
