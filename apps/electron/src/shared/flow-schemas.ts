import { z } from 'zod'

// ─── Task & Epic Status ───────────────────────────────────────────────

export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'blocked', 'done'])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const EpicStatusSchema = z.enum(['open', 'done'])
export type EpicStatus = z.infer<typeof EpicStatusSchema>

// ─── Task (full detail from `flowctl show <task> --json`) ─────────────

export const TaskSchema = z.object({
  success: z.boolean(),
  id: z.string(),
  epic: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  priority: z.string().nullable(),
  depends_on: z.array(z.string()),
  assignee: z.string().nullable().optional(),
  claim_note: z.string().optional(),
  claimed_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  spec_path: z.string(),
  evidence: z.object({
    commits: z.array(z.string()),
    prs: z.array(z.string()),
    tests: z.array(z.string()),
  }).nullable().optional(),
  impl: z.unknown().nullable().optional(),
  review: z.unknown().nullable().optional(),
  sync: z.unknown().nullable().optional(),
})
export type Task = z.infer<typeof TaskSchema>

// ─── Task (summary, from `flowctl tasks --epic <id> --json`) ──────────

export const TaskSummarySchema = z.object({
  id: z.string(),
  epic: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  priority: z.string().nullable(),
  depends_on: z.array(z.string()),
})
export type TaskSummary = z.infer<typeof TaskSummarySchema>

export const TaskListResponseSchema = z.object({
  success: z.boolean(),
  tasks: z.array(TaskSummarySchema),
})
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>

// ─── Epic (summary, from `flowctl epics --json`) ──────────────────────

export const EpicSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: EpicStatusSchema,
  tasks: z.number(),
  done: z.number(),
  // Optional fields — may be present in newer flowctl versions
  in_progress: z.number().optional(),
  updated_at: z.string().optional(),
})
export type EpicSummary = z.infer<typeof EpicSummarySchema>

export const EpicListResponseSchema = z.object({
  success: z.boolean(),
  epics: z.array(EpicSummarySchema),
  count: z.number(),
})
export type EpicListResponse = z.infer<typeof EpicListResponseSchema>

// ─── Epic (full detail from `flowctl show <epic> --json`) ─────────────

export const EpicTaskEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  priority: z.string().nullable(),
  depends_on: z.array(z.string()),
})

export const EpicSchema = z.object({
  success: z.boolean(),
  id: z.string(),
  title: z.string(),
  status: EpicStatusSchema,
  branch_name: z.string(),
  spec_path: z.string(),
  depends_on_epics: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
  plan_review_status: z.string().nullable().optional(),
  plan_reviewed_at: z.string().nullable().optional(),
  completion_review_status: z.string().nullable().optional(),
  completion_reviewed_at: z.string().nullable().optional(),
  default_impl: z.unknown().nullable().optional(),
  default_review: z.unknown().nullable().optional(),
  default_sync: z.unknown().nullable().optional(),
  next_task: z.number().optional(),
  tasks: z.array(EpicTaskEntrySchema),
})
export type Epic = z.infer<typeof EpicSchema>

// ─── FlowBridge Error Types ──────────────────────────────────────────

// ─── Reusable Command Response Schema ────────────────────────────────

export const CommandSuccessSchema = z.object({ success: z.boolean() })
export type CommandSuccess = z.infer<typeof CommandSuccessSchema>

// ─── Epic Creation Response (from `flowctl epic create --json`) ────────

export const EpicCreateResponseSchema = z.object({
  success: z.boolean(),
  id: z.string(),           // e.g., "fn-3-user-authentication"
  title: z.string(),
  spec_path: z.string(),    // e.g., ".flow/specs/fn-3-user-authentication.md"
  message: z.string().optional(),
})
export type EpicCreateResponse = z.infer<typeof EpicCreateResponseSchema>

// ─── Epic Set-Plan Response (from `flowctl epic set-plan --json`) ────────

export const EpicSetPlanResponseSchema = z.object({
  success: z.boolean(),
  id: z.string(),
  spec_path: z.string(),
  message: z.string().optional(),
})
export type EpicSetPlanResponse = z.infer<typeof EpicSetPlanResponseSchema>

// ─── FlowBridge Error Types ──────────────────────────────────────────

export type FlowBridgeError =
  | { type: 'flowctl_not_found' }
  | { type: 'invalid_json'; stdout: string }
  | { type: 'invalid_output'; zodError: z.ZodError }
  | { type: 'command_failed'; stderr: string; exitCode: number }
  | { type: 'timeout'; command: string }
  | { type: 'no_project_configured' }

export type FlowBridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: FlowBridgeError }
