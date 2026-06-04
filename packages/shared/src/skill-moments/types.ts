export type SkillFeedbackVerdict = 1 | 2 | 3

export type SkillMomentSourceKind = 'china_daily' | 'x' | 'polymarket' | 'manual' | 'mock'

export type SkillMomentSourceDigest = {
  id: string
  source: SkillMomentSourceKind
  title: string
  url: string
  summary: string
  publishedAt?: string
  capturedAt: string
  status: 'ready' | 'mock' | 'unavailable' | 'stale'
}

export type SkillMomentReaction = {
  skillId: string
  skillName: string
  handle: string
  kind: 'like'
  createdAt: string
}

export type SkillMomentCritique = {
  id: string
  parentMomentId: string
  criticSkillId: string
  criticSkillName: string
  criticHandle: string
  body: string
  createdAt: string
  reactions?: SkillMomentReaction[]
  artifacts?: string[]
  feedbackVerdict?: SkillFeedbackVerdict
  feedbackSavedPath?: string
}

export type SkillMomentMedia = {
  id: string
  type: 'image'
  path: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  alt?: string
  sourceUrl?: string
  width?: number
  height?: number
}

export type SkillMoment = {
  id: string
  roomId: string
  skillId: string
  skillName: string
  handle: string
  body: string
  confidence: 'low' | 'medium' | 'high'
  createdAt: string
  sources: SkillMomentSourceDigest[]
  critiques: SkillMomentCritique[]
  reactions?: SkillMomentReaction[]
  media?: SkillMomentMedia[]
  artifacts?: string[]
  feedbackVerdict?: SkillFeedbackVerdict
  feedbackSavedPath?: string
}

export type SkillMomentSkillInput = {
  id: string
  name: string
  handle: string
  description?: string
}

export type SkillMomentListInput = {
  workspaceId: string
  roomId?: string
  limit?: number
}

export type SkillMomentListResult = {
  moments: SkillMoment[]
}

export type SkillMomentExecutionMode = 'mock' | 'real'

export type SkillMomentStageControlLevel = 'human_locked' | 'human_guided' | 'free_actor'

export type SkillMomentStageSceneType = 'friend_circle' | 'tavern' | 'edict_council' | 'screenplay'

export type SkillMomentStageMediaPolicy =
  | 'disabled'
  | 'allow_one_image_if_author_requests'
  | 'allow_actor_requested_images'

export type SkillMomentStageHumanGate = 'before_persist' | 'draft_only' | 'none'

export type SkillMomentStageControl = {
  schemaVersion?: 1
  stageId?: string
  controlLevel?: SkillMomentStageControlLevel
  sceneType?: SkillMomentStageSceneType
  directorCommand: string
  activeCast?: string[]
  speakerOrder?: string[]
  conflictTarget?: string
  mediaPolicy?: SkillMomentStageMediaPolicy
  humanGate?: SkillMomentStageHumanGate
  maxMoments?: number
  maxCriticsPerMoment?: number
}

export type SkillMomentShowEvaluationMetric = {
  score: number
  summary: string
  evidence: string[]
}

export type SkillMomentShowFeedbackCalibration = {
  schemaVersion: 1
  method: 'heuristic_feedback_adjustment'
  roomId: string
  baseScore: number
  adjustedScore: number
  adjustment: number
  counts: {
    evolve: number
    unchanged: number
    regress: number
    total: number
  }
  sampleWindow: number
  source: 'skill_moments_feedback_jsonl'
  sourcePath?: string
  latestRecordedAt?: string
  reason: string
}

export type SkillMomentShowEvaluation = {
  schemaVersion: 1
  overallScore: number
  repetition: SkillMomentShowEvaluationMetric
  conflictStrength: SkillMomentShowEvaluationMetric
  visuality: SkillMomentShowEvaluationMetric
  actorParticipation: SkillMomentShowEvaluationMetric
  mediaMissingRisk: SkillMomentShowEvaluationMetric
  feedbackCalibration?: SkillMomentShowFeedbackCalibration
  notes: string[]
}

export type SkillMomentDemoContract = {
  schemaVersion: 1
  title: string
  scene: SkillMomentStageSceneType
  conflict?: {
    left: string
    right: string
    publicLabel?: string
  }
  goal: string
  requiredBeats: string[]
  antiRepeatRules: string[]
  feedbackInfluence?: string
  originalShell?: {
    protagonist: string
    antagonist: string
    world: string
  }
}

export type SkillMomentActorIntentCard = {
  schemaVersion: 1
  skillId: string
  skillName: string
  handle: string
  slug: string
  role: string
  goal: string
  memory: string
  nextAction: string
  target?: string
  visibility: 'public' | 'private' | 'comment' | 'like' | 'silent'
  mediaIntent?: boolean
  risk?: string
}

export type SkillMomentRunCycleInput = {
  workspaceId: string
  roomId?: string
  runId?: string
  mode?: SkillMomentExecutionMode
  stageControl?: SkillMomentStageControl
  skills?: SkillMomentSkillInput[]
  skillSlugs?: string[]
  workingDirectory?: string
  maxMoments?: number
  maxCriticsPerMoment?: number
}

export type SkillMomentRunCycleResult = {
  success: boolean
  runId: string
  state?: 'started' | 'completed' | 'failed'
  moments: SkillMoment[]
  sourceDigests: SkillMomentSourceDigest[]
  path: string
}

export type SkillMomentRunStatusPhase =
  | 'planning'
  | 'writing'
  | 'media_prompt'
  | 'browser_prepare'
  | 'browser_prompt'
  | 'browser_waiting'
  | 'browser_capture'
  | 'browser_error'
  | 'persisting'
  | 'complete'
  | 'error'

export type SkillMomentRunStatusEvent = {
  workspaceId: string
  roomId: string
  runId?: string
  sequence?: number
  phase: SkillMomentRunStatusPhase
  message: string
  detail?: string
  workerNarration?: string
  failureEvidence?: string
  domSummary?: string
  debugUrl?: string
  showScore?: number
  showEvaluation?: SkillMomentShowEvaluation
  demoContract?: SkillMomentDemoContract
  actorIntents?: SkillMomentActorIntentCard[]
  createdAt: string
}

export type SkillMomentRunJobState = 'queued' | 'running' | 'succeeded' | 'failed'

export type SkillMomentRunJobFailure = {
  code?: string
  message: string
  name?: string
  stack?: string
  failedAt: string
  event: SkillMomentRunStatusEvent
}

export type SkillMomentRunJobRecovery = {
  code: 'recovered_without_executor' | 'restarted_from_audit'
  source: 'run-jobs.jsonl'
  recoveredAt: string
  previousState: SkillMomentRunJobState
  message: string
}

export type SkillMomentRunJobAudit = {
  runId: string
  workspaceId: string
  roomId: string
  state: SkillMomentRunJobState
  startedAt: string
  input?: SkillMomentRunCycleInput
  endedAt?: string
  result?: SkillMomentRunCycleResult
  error?: string
  failure?: SkillMomentRunJobFailure
  recovered?: boolean
  recovery?: SkillMomentRunJobRecovery
  eventCount: number
  droppedEventCount: number
  lastEvent?: SkillMomentRunStatusEvent
  events: SkillMomentRunStatusEvent[]
}

export type SkillMomentRunJobGetInput = {
  workspaceId: string
  runId: string
}

export type SkillMomentRunJobListInput = {
  workspaceId: string
  roomId?: string
  limit?: number
}

export type SkillMomentRunJobWaitInput = {
  workspaceId: string
  runId: string
  timeoutMs?: number
}

export type SkillMomentRunJobGetResult = {
  job?: SkillMomentRunJobAudit
}

export type SkillMomentRunJobListResult = {
  jobs: SkillMomentRunJobAudit[]
}

export type SkillMomentRunJobWaitResult = {
  job: SkillMomentRunJobAudit
}

export type SkillMomentFeedbackRecordInput = {
  workspaceId: string
  roomId: string
  momentId: string
  critiqueId?: string
  skillId: string
  skillName?: string
  handle?: string
  verdict: SkillFeedbackVerdict
  messageBody: string
  prompt?: string
  sources?: SkillMomentSourceDigest[]
  sourceLinks?: string[]
  recordedAt?: string
}

export type SkillMomentFeedbackRecordResult = {
  success: boolean
  path: string
  evolutionCandidatePath?: string
}

export type SkillMomentEvolutionCandidateStatus = 'pending_review' | 'accepted' | 'rejected'

export type SkillMomentEvolutionCandidateReviewedStatus = 'accepted' | 'rejected'

export type SkillMomentEvolutionCandidateReviewState = 'pending' | 'reviewed'

export type SkillMomentEvolutionCandidate = {
  schemaVersion: 1
  source: 'debt.skill-moments.feedback'
  status: SkillMomentEvolutionCandidateStatus
  candidateId: string
  createdAt: string
  reviewedAt?: string
  reviewedBy?: {
    id?: string
    name?: string
  }
  reviewNote?: string
  roomId: string
  skill: {
    id: string
    name?: string
    handle?: string
  }
  target: {
    kind: 'moment' | 'critique'
    roomId: string
    momentId: string
    critiqueId?: string
  }
  proposedInstructionDelta: {
    kind: 'reinforce' | 'guardrail'
    summary: string
    instructionHint: string
  }
  positiveEvidence: Array<{
    verdict: 1
    recordedAt: string
    response: string
    sourceLinks: string[]
  }>
  regressionEvidence: Array<{
    verdict: 3
    recordedAt: string
    response: string
    sourceLinks: string[]
  }>
  neutralEvidenceCount: number
  doesNotAutoApply: true
}

export type SkillMomentEvolutionCandidateListInput = {
  workspaceId: string
  reviewState?: SkillMomentEvolutionCandidateReviewState
  status?: SkillMomentEvolutionCandidateStatus
  roomId?: string
  skillId?: string
  limit?: number
}

export type SkillMomentEvolutionCandidateListResult = {
  candidates: SkillMomentEvolutionCandidate[]
}

export type SkillMomentEvolutionCandidateReviewInput = {
  workspaceId: string
  candidateId: string
  status: SkillMomentEvolutionCandidateReviewedStatus
  reviewedAt?: string
  reviewedBy?: {
    id?: string
    name?: string
  }
  reviewNote?: string
}

export type SkillMomentEvolutionCandidateReviewResult = {
  success: boolean
  path: string
  candidate: SkillMomentEvolutionCandidate
}
