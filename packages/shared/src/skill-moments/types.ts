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

export type SkillMomentRunCycleInput = {
  workspaceId: string
  roomId?: string
  mode?: SkillMomentExecutionMode
  skills?: SkillMomentSkillInput[]
  skillSlugs?: string[]
  workingDirectory?: string
  maxMoments?: number
  maxCriticsPerMoment?: number
}

export type SkillMomentRunCycleResult = {
  success: boolean
  runId: string
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
  phase: SkillMomentRunStatusPhase
  message: string
  detail?: string
  createdAt: string
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
}
