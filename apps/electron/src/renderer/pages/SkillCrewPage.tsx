import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  Bot,
  Check,
  Copy,
  Crown,
  FileDown,
  GitBranch,
  MessageSquareQuote,
  Radio,
  Send,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { skillsAtom } from '@/atoms/skills'
import { skillCrewChannelAtom } from '@/atoms/skill-crew'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { SkillMomentsView, type SkillMomentFeedbackTarget } from '@/components/skill-crew/moments/SkillMomentsView'
import { feedbackTargetKey } from '@/components/skill-crew/moments/types'
import { useAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import type { LoadedSkill, SkillFeedbackVerdict, SkillMoment } from '../../shared/types'
import {
  DEFAULT_SKILL_CREW_ROOMS,
  GLOBAL_SKILL_CREW_ROOM,
  inferSkillCrewRoomId,
  inferSkillPhysicalFolderId,
  isGlobalSkillCrewSkill,
  skillCrewPlacementAtom,
} from '@/atoms/skill-crew'

type CrewRole = {
  id: string
  name: string
  handle: string
  description: string
  skill?: LoadedSkill
  chairman?: boolean
  global?: boolean
}

type CrewMessage = {
  id: string
  role: 'user' | 'agent' | 'chairman' | 'system'
  author: string
  handle?: string
  skillId?: string
  body: string
  timestamp: string
  quoteId?: string
  artifacts?: string[]
  feedbackVerdict?: SkillFeedbackVerdict
  feedbackSavedPath?: string
  runStartedAt?: number
  runEndedAt?: number
  elapsedMs?: number
  contextChars?: number
  contextTokensEstimate?: number
}

type CrewBranch = {
  id: string
  title: string
  sourceMessageId?: string
  messages: CrewMessage[]
}

type StoredCrewConversation = {
  schemaVersion: 1
  activeBranchId?: string
  branches: CrewBranch[]
}

type ComposerFrame = {
  left: number
  width: number
  bottom: number
}

const SKILL_CREW_CONVERSATION_STORAGE_PREFIX = 'debt.skillCrew.conversation.v1'
const SKILL_SILENCE_MARKER = '<SILENCE/>'

const skillFeedbackOptions: Array<{
  verdict: SkillFeedbackVerdict
  label: string
  artifact: string
}> = [
  { verdict: 1, label: '1 进化', artifact: 'feedback_evolve' },
  { verdict: 2, label: '2 不变', artifact: 'feedback_unchanged' },
  { verdict: 3, label: '3 退化', artifact: 'feedback_regress' },
]

function skillFeedbackLabel(verdict?: SkillFeedbackVerdict) {
  return skillFeedbackOptions.find((option) => option.verdict === verdict)?.label
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 3))
}

function normalizeSkillReplyText(text: string) {
  return text
    .trim()
    .replace(/^```(?:text|plain)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function isSkillSilenceReply(text: string) {
  const normalized = normalizeSkillReplyText(text)
  return normalized === SKILL_SILENCE_MARKER || normalized === 'SILENCE'
}

function formatCompactNumber(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
  }

  return String(value)
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 100) / 10)
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  }

  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

function buildRunMetaParts(message: CrewMessage, now: number) {
  const parts: string[] = []

  if (message.contextTokensEstimate || message.contextChars) {
    const tokenPart = message.contextTokensEstimate
      ? `context ~${formatCompactNumber(message.contextTokensEstimate)} tok`
      : 'context unknown'
    const charsPart = message.contextChars
      ? `${formatCompactNumber(message.contextChars)} chars`
      : ''
    parts.push([tokenPart, charsPart].filter(Boolean).join(' / '))
  }

  if (message.runStartedAt) {
    const elapsed = message.elapsedMs ?? Math.max(0, now - message.runStartedAt)
    const label = message.runEndedAt ? '用时' : '回复中'
    parts.push(`${label} ${formatDuration(elapsed)}`)
  }

  return parts
}

const channelLabels = {
  debate: 'debate',
  design: 'design',
  build: 'build',
  policy: 'policy',
}

function formatChannelLabel(channelId: string): string {
  return channelLabels[channelId as keyof typeof channelLabels] ?? channelId.split('/').pop() ?? channelId
}

function buildRoles(skills: LoadedSkill[]): CrewRole[] {
  const chairmanSkill = skills.find((skill) => skill.slug === 'chairman')
  const loaded = skills.filter((skill) => skill.slug !== 'chairman').map((skill): CrewRole => ({
    id: skill.slug,
    name: skill.metadata.name || skill.slug,
    handle: `@${skill.slug}`,
    description: skill.metadata.description || '本地 Craft skill',
    skill,
    global: skill.slug === 'skillcreator' || isGlobalSkillCrewSkill(skill),
  }))
  const hasSkillCreator = loaded.some((role) => role.id === 'skillcreator')

  return [
    {
      id: '__chairman__',
      name: '董事长',
      handle: '@董事长',
      description: '召集 skill、安排轮次、压缩分歧并给出下一步。',
      chairman: true,
      global: true,
      skill: chairmanSkill,
    },
    ...(hasSkillCreator ? [] : [{
      id: 'skillcreator',
      name: 'skillcreator',
      handle: '@skillcreator',
      description: '把自然语言里的“人”提炼成可复用 skill。',
      global: true,
    }]),
    ...loaded,
  ]
}

function formatTime() {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())
}

function cleanSelectedPrompt(text: string, targets: CrewRole[]) {
  let cleaned = text
  for (const target of targets) {
    cleaned = cleaned.replaceAll(target.handle, '')
  }
  return cleaned.replace(/\s+/g, ' ').trim()
}

function makeModelSelfReply(prompt: string, quote?: CrewMessage): string {
  const quoteLine = quote ? `我先接住引用里的上下文：“${quote.body.slice(0, 80)}”。` : ''
  return [
    quoteLine,
    '未检测到从下拉菜单选中的 @skill，我按模型自身直接回答。手打 @ 文本不会触发 skill，避免输错名字误唤醒。',
    `针对“${prompt || '这个议题'}”，我先给出通用判断；如果你从 @ 菜单选中某个 skill，我再切换到那个 skill 的角色边界和工作方式。`,
  ].filter(Boolean).join('\n')
}

function makeSkillFallbackReply(role: CrewRole, prompt: string, errorText: string): string {
  const errorSummary = errorText.length > 180 ? `${errorText.slice(0, 180)}...` : errorText
  const preface = [
    `模型连接暂不可用：${errorSummary}`,
    '以下是本地降级发言：根据该 skill 的角色契约生成，未执行 GitHub 搜索，不等同于真实模型返回。',
  ].join('\n')

  if (role.id === 'sun-yuchen') {
    return [
      preface,
      '',
      '孙宇晨视角:',
      '- 主张: OPC 公司先别把自己做成咨询公司，要做成一个能被公开看见、能迅速传播、能接入生态的 AI 原生产品。',
      '- 最该做的 OPC: 面向 AI 超级个体的研发与决策工作台，把 skill、GitHub 资产、飞书协作和政策申报材料生成串成一条可演示链路。',
      '- GitHub/技术资产怎么包装: GitHub fact 未搜索；市场包装上，应把已存在 repo 作为“持续交付能力”的证据，把 skill crew 作为产品界面，把政策材料作为第一个付费/申报场景。',
      '- 7 天动作: 做一个可录屏 demo，选 3 个高质量 GitHub 项目做案例页，发布“一个人带 10 个 AI 角色做公司”的故事，再找园区/创业者试用。',
      '- 最大风险: 只有叙事没有可复用产品；以及上游开源、第三方模型、飞书接口的 IP 和依赖边界没讲清。',
      '- 我反驳哈耶克: 市场发现当然重要，但你不能等市场给你答案；先用强叙事把第一批人拉进来，反馈才会出现。',
    ].join('\n')
  }

  if (role.id === 'hayek') {
    return [
      preface,
      '',
      '哈耶克视角:',
      '- 主张: OPC 公司不应先设计一个宏大的中心计划，而应把自己变成快速发现需求的制度化实验机器。',
      '- 最该做的 OPC: 选择一个创始人真正拥有局部知识的细分场景，例如 AI 研发编排、申报材料生成、或小团队 agent 协作，而不是泛泛宣称“AI 一人公司平台”。',
      '- GitHub/技术资产怎么验证: GitHub fact 未搜索；验证方式应是检查 README、可运行 demo、最近提交、真实用户问题和可复用工作流，而不是只看项目数量。',
      '- 市场发现实验: 先找 5 个真实 OPC/独立开发者，让他们用同一套 skill crew 完成一个具体任务，记录节省时间、失败点、愿付价格和复用频次。',
      '- 最大风险: 政策补贴扭曲判断，让公司为申报材料而不是用户价值优化；另一个风险是把不同开源能力误包装成原创资产。',
      '- 我反驳孙宇晨: 叙事可以降低搜索成本，但如果没有可观察的市场信号，强叙事会把错误方向放大得更快。',
    ].join('\n')
  }

  return [
    preface,
    '',
    `${role.name} 视角:`,
    `- 收到的问题: ${prompt || '继续当前讨论。'}`,
    `- 角色边界: ${role.description}`,
    '- 下一步: 请恢复可用模型连接后重新发送；届时该 skill 会读取 SKILL.md 并生成真实回复。',
  ].join('\n')
}

function seedMessages(): CrewMessage[] {
  return [
    {
      id: 'seed-1',
      role: 'chairman',
      author: '董事长',
      handle: '@董事长',
      skillId: 'chairman',
      body: '这里是 Skill Crew 工作区。你可以直接 @skill 提问，也可以 @董事长 召集多个 skill 讨论、辩论、归纳。',
      timestamp: formatTime(),
      artifacts: ['channel_bootstrap', 'chairman_protocol'],
    },
    {
      id: 'seed-2',
      role: 'agent',
      author: 'skillcreator',
      handle: '@skillcreator',
      skillId: 'skillcreator',
      body: '我负责把自然语言里的“人”提炼成可复用 skill：角色边界、醒来条件、发言方式、交接工件。',
      timestamp: formatTime(),
      artifacts: ['persona_contract'],
    },
  ]
}

function defaultBranches(): CrewBranch[] {
  return [{ id: 'main', title: 'main', messages: seedMessages() }]
}

function conversationStorageKey(workspaceId: string | null | undefined, channelId: string): string {
  return [
    SKILL_CREW_CONVERSATION_STORAGE_PREFIX,
    workspaceId || 'no-workspace',
    encodeURIComponent(channelId),
  ].join(':')
}

function isStoredCrewMessage(value: unknown): value is CrewMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<CrewMessage>
  return typeof candidate.id === 'string'
    && typeof candidate.role === 'string'
    && typeof candidate.author === 'string'
    && typeof candidate.body === 'string'
    && typeof candidate.timestamp === 'string'
}

function normalizeStoredBranches(value: unknown): CrewBranch[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const branches = value
    .map((branch): CrewBranch | null => {
      if (!branch || typeof branch !== 'object') {
        return null
      }

      const candidate = branch as Partial<CrewBranch>
      if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string' || !Array.isArray(candidate.messages)) {
        return null
      }

      const messages = candidate.messages.filter(isStoredCrewMessage)
      return {
        id: candidate.id,
        title: candidate.title,
        sourceMessageId: typeof candidate.sourceMessageId === 'string' ? candidate.sourceMessageId : undefined,
        messages,
      }
    })
    .filter((branch): branch is CrewBranch => Boolean(branch))

  return branches.length > 0 ? branches : null
}

function loadStoredConversation(key: string): StoredCrewConversation {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      return { schemaVersion: 1, activeBranchId: 'main', branches: defaultBranches() }
    }

    const parsed = JSON.parse(raw) as Partial<StoredCrewConversation>
    const branches = normalizeStoredBranches(parsed.branches)
    if (!branches) {
      return { schemaVersion: 1, activeBranchId: 'main', branches: defaultBranches() }
    }

    const activeBranchId = parsed.activeBranchId && branches.some((branch) => branch.id === parsed.activeBranchId)
      ? parsed.activeBranchId
      : branches[0]?.id ?? 'main'

    return { schemaVersion: 1, activeBranchId, branches }
  } catch {
    return { schemaVersion: 1, activeBranchId: 'main', branches: defaultBranches() }
  }
}

function saveStoredConversation(key: string, conversation: StoredCrewConversation): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(conversation))
  } catch (error) {
    console.warn('[SkillCrew] Failed to persist conversation', error)
  }
}

function buildMessageClipboardText(message: CrewMessage) {
  const runMeta = buildRunMetaParts(message, Date.now())
  return [
    `${message.author}${message.handle ? ` ${message.handle}` : ''} ${message.timestamp}`,
    message.body,
    runMeta.length ? `Run: ${runMeta.join(' | ')}` : '',
    message.feedbackVerdict ? `Feedback: ${skillFeedbackLabel(message.feedbackVerdict)}` : '',
    message.feedbackSavedPath ? `Feedback sample: ${message.feedbackSavedPath}` : '',
    message.artifacts?.length ? `Artifacts: ${message.artifacts.join(', ')}` : '',
  ].filter(Boolean).join('\n')
}

function buildBranchClipboardText(branch: CrewBranch) {
  return branch.messages.map(buildMessageClipboardText).join('\n\n---\n\n')
}

function buildMessageMarkdown(message: CrewMessage, messageById: Map<string, CrewMessage>) {
  const quotedMessage = message.quoteId ? messageById.get(message.quoteId) : undefined
  const runMeta = buildRunMetaParts(message, Date.now())
  return [
    `### ${message.author}${message.handle ? ` ${message.handle}` : ''} · ${message.timestamp}`,
    quotedMessage ? `> 引用 ${quotedMessage.author}: ${quotedMessage.body.replace(/\n/g, '\n> ')}` : '',
    message.body,
    runMeta.length ? `\nRun: ${runMeta.join(' | ')}` : '',
    message.feedbackVerdict ? `\nFeedback: ${skillFeedbackLabel(message.feedbackVerdict)}` : '',
    message.feedbackSavedPath ? `Feedback sample: \`${message.feedbackSavedPath}\`` : '',
    message.artifacts?.length ? `\nArtifacts: ${message.artifacts.map((artifact) => `\`${artifact}\``).join(', ')}` : '',
  ].filter(Boolean).join('\n\n')
}

function buildConversationMarkdown(branches: CrewBranch[], activeChannel: string) {
  const now = new Date().toISOString()
  return [
    `# Skill Crew #${formatChannelLabel(activeChannel)} Conversation`,
    '',
    `Exported: ${now}`,
    `Branches: ${branches.length}`,
    '',
    ...branches.flatMap((branch, index) => {
      const messageById = new Map(branch.messages.map((message) => [message.id, message]))
      return [
        `## Branch ${index + 1}: ${branch.title}`,
        branch.sourceMessageId ? `Source message: \`${branch.sourceMessageId}\`` : '',
        '',
        ...branch.messages.map((message) => buildMessageMarkdown(message, messageById)),
        '',
      ].filter(Boolean)
    }),
  ].join('\n')
}

function downloadMarkdown(filename: string, markdown: string) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function inferSkillWorkspaceRoot(skillDirectoryPath?: string) {
  if (!skillDirectoryPath) {
    return undefined
  }

  const marker = '/skills/'
  const markerIndex = skillDirectoryPath.indexOf(marker)
  if (markerIndex === -1) {
    return undefined
  }

  return skillDirectoryPath.slice(0, markerIndex)
}

function roleBelongsToChannel(role: CrewRole, activeChannel: string, placement: Record<string, string>) {
  if (role.chairman || role.global) {
    return true
  }

  if (!role.skill) {
    return false
  }

  const knownFolderIds = Array.from(new Set([
    activeChannel,
    GLOBAL_SKILL_CREW_ROOM,
    ...DEFAULT_SKILL_CREW_ROOMS,
    ...Object.values(placement),
  ]))
  const folderId = placement[role.id] ?? inferSkillPhysicalFolderId(role.skill, knownFolderIds) ?? inferSkillCrewRoomId(role.skill)
  return folderId === activeChannel || folderId === GLOBAL_SKILL_CREW_ROOM || activeChannel === 'chairman'
}

function parseMentionState(value: string, cursor: number) {
  const beforeCursor = value.slice(0, cursor)
  const match = beforeCursor.match(/(^|\s)@([\p{L}\p{N}_-]*)$/u)
  if (!match || match.index === undefined) {
    return null
  }

  const prefixLength = match[1]?.length ?? 0
  const query = match[2] ?? ''
  const start = match.index + prefixLength

  return { start, query }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const mentionBoundary = String.raw`[\s,.;:!?，。！？、；：]`

function findMentionedRoleIds(text: string, roles: CrewRole[]) {
  const matchedIds: string[] = []

  for (const role of roles) {
    const matcher = new RegExp(`(^|${mentionBoundary})${escapeRegExp(role.handle)}(?=$|${mentionBoundary})`, 'u')
    if (matcher.test(text)) {
      matchedIds.push(role.id)
    }
  }

  return matchedIds
}

function removeMentionHandle(text: string, handle: string) {
  const matcher = new RegExp(`(^|${mentionBoundary})${escapeRegExp(handle)}(?=$|${mentionBoundary})`, 'gu')
  return text
    .replace(matcher, (match, prefix: string) => (prefix ? prefix : match.startsWith(handle) ? '' : match))
    .replace(/[ \t]{2,}/g, ' ')
    .trimStart()
}

function buildSkillInvocationPrompt({
  role,
  prompt,
  quote,
  activeChannel,
  selectedRoles,
  skillContent,
  skillDirectoryPath,
}: {
  role: CrewRole
  prompt: string
  quote?: CrewMessage
  activeChannel: string
  selectedRoles: CrewRole[]
  skillContent: string
  skillDirectoryPath?: string
}) {
  const quotedContext = quote
    ? `\n引用上下文:\n<quote author="${quote.author}" handle="${quote.handle ?? ''}">\n${quote.body}\n</quote>`
    : ''
  const selectedHandles = selectedRoles.map((selected) => selected.handle).join(', ') || role.handle

  return [
    `你正在 Skill Crew 的 #${formatChannelLabel(activeChannel)} 文件夹中发言。`,
    `你被用户通过下拉菜单明确选中为 ${role.handle}。`,
    `同轮选中的 skill: ${selectedHandles}`,
    skillDirectoryPath ? `完整 skill 目录路径: ${skillDirectoryPath}` : '',
    '',
    '下面是你的 SKILL.md 入口指令。请严格按这个角色、边界、触发条件和输出契约工作。',
    '<SKILL_MD>',
    skillContent.trim(),
    '</SKILL_MD>',
    quotedContext,
    '',
    '用户请求:',
    prompt || '请根据当前上下文继续。',
    '',
    '执行要求:',
    '- 直接完成请求，不要只复述你的角色边界。',
    '- 像聊天室里的路人角色一样发言：先接住当前语境，再提出你这个 skill 真正在意的一个问题；不要输出空泛评审句。',
    `- 先做沉默阈值判断：如果你的发言不能增加新问题、新证据、新行动、新角色冲突或明确执行结果，请只输出 \`${SKILL_SILENCE_MARKER}\`，不要解释。`,
    '- 如果 SKILL.md 引用 references/、agents/、evals/ 或 scripts/，请按完整 skill 目录路径读取相对文件。',
    '- 如果需要搜索、读文件或写文件，但当前权限/上下文不足，请明确说明缺什么。',
    '- 如果执行文件写入，默认只改当前工作区 skills 目录或用户明确指定的路径。',
    '- 输出给 Skill Crew 聊天窗口，保持自然语言可读。',
    '- 如果你需要把任务交给其他 skill，请产出明确的 task packet。',
  ].filter(Boolean).join('\n')
}

function buildModelSelfInvocationPrompt({
  prompt,
  quote,
  activeChannel,
}: {
  prompt: string
  quote?: CrewMessage
  activeChannel: string
}) {
  const quotedContext = quote
    ? `\n引用上下文:\n<quote author="${quote.author}" handle="${quote.handle ?? ''}">\n${quote.body}\n</quote>`
    : ''

  return [
    `你正在 Skill Crew 的 #${formatChannelLabel(activeChannel)} 文件夹中发言。`,
    '本轮用户没有通过有效 @handle 选择 skill，所以你以模型自身身份直接回答。',
    quotedContext,
    '',
    '用户请求:',
    prompt || '请根据当前上下文继续。',
    '',
    '执行要求:',
    '- 直接回答用户问题，不要声称自己是某个 skill。',
    '- 如果需要引用上下文，先利用引用信息，再给出判断。',
    '- 保持自然语言可读，匹配用户语言。',
  ].filter(Boolean).join('\n')
}

export default function SkillCrewPage() {
  const { activeWorkspaceId, activeSessionWorkingDirectory } = useAppShellContext()
  const avatarWorkspaceId = activeWorkspaceId ?? undefined
  const skills = useAtomValue(skillsAtom)
  const setSkills = useSetAtom(skillsAtom)
  const activeChannel = useAtomValue(skillCrewChannelAtom)
  const skillPlacement = useAtomValue(skillCrewPlacementAtom)
  const roles = React.useMemo(() => buildRoles(skills), [skills])
  const mentionableRoles = React.useMemo(
    () => roles.filter((role) => roleBelongsToChannel(role, activeChannel, skillPlacement)),
    [activeChannel, roles, skillPlacement],
  )
  const storageKey = React.useMemo(
    () => conversationStorageKey(activeWorkspaceId, activeChannel),
    [activeChannel, activeWorkspaceId],
  )
  const [hydratedStorageKey, setHydratedStorageKey] = React.useState<string | null>(null)
  const [branches, setBranches] = React.useState<CrewBranch[]>(() => defaultBranches())
  const [activeBranchId, setActiveBranchId] = React.useState('main')
  const [draft, setDraft] = React.useState('')
  const [quoteId, setQuoteId] = React.useState<string | undefined>()
  const [copiedId, setCopiedId] = React.useState<string | undefined>()
  const [selectedTargetIds, setSelectedTargetIds] = React.useState<string[]>([])
  const [mentionState, setMentionState] = React.useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = React.useState(0)
  const [feedbackPendingId, setFeedbackPendingId] = React.useState<string | undefined>()
  const [runClockNow, setRunClockNow] = React.useState(() => Date.now())
  const [activeCrewSurface, setActiveCrewSurface] = React.useState<'chat' | 'moments' | 'agentos'>('chat')
  const [skillMoments, setSkillMoments] = React.useState<SkillMoment[]>([])
  const [skillMomentsLoading, setSkillMomentsLoading] = React.useState(false)
  const [skillMomentsRunning, setSkillMomentsRunning] = React.useState(false)
  const [skillMomentsLastRunPath, setSkillMomentsLastRunPath] = React.useState<string | undefined>()
  const [skillMomentFeedbackPendingKey, setSkillMomentFeedbackPendingKey] = React.useState<string | undefined>()
  const activeBranch = branches.find((branch) => branch.id === activeBranchId) ?? branches[0]
  const messages = activeBranch?.messages ?? []
  const quote = messages.find((message) => message.id === quoteId)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const mainRef = React.useRef<HTMLElement | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [composerFrame, setComposerFrame] = React.useState<ComposerFrame | undefined>()

  const selectedTargets = React.useMemo(
    () => selectedTargetIds
      .map((id) => roles.find((role) => role.id === id))
      .filter((role): role is CrewRole => Boolean(role)),
    [roles, selectedTargetIds],
  )

  const filteredMentionRoles = React.useMemo(() => {
    if (!mentionState) {
      return []
    }

    const query = mentionState.query.toLocaleLowerCase()
    const filtered = mentionableRoles.filter((role) => {
      if (!query) return true
      return (
        role.id.toLocaleLowerCase().includes(query)
        || role.name.toLocaleLowerCase().includes(query)
        || role.handle.slice(1).toLocaleLowerCase().includes(query)
      )
    })

    return filtered.slice(0, 8)
  }, [mentionState, mentionableRoles])

  React.useEffect(() => {
    setHydratedStorageKey(null)
    const stored = loadStoredConversation(storageKey)
    setBranches(stored.branches)
    setActiveBranchId(stored.activeBranchId ?? stored.branches[0]?.id ?? 'main')
    setDraft('')
    setQuoteId(undefined)
    setSelectedTargetIds([])
    setMentionState(null)
    setHydratedStorageKey(storageKey)
  }, [storageKey])

  React.useEffect(() => {
    if (hydratedStorageKey !== storageKey) {
      return
    }

    saveStoredConversation(storageKey, {
      schemaVersion: 1,
      activeBranchId,
      branches,
    })
  }, [activeBranchId, branches, hydratedStorageKey, storageKey])

  React.useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: 'end' })
  }, [activeBranchId, messages.length])

  React.useEffect(() => {
    const hasPendingRun = messages.some((message) => message.runStartedAt && !message.runEndedAt)
    if (!hasPendingRun) {
      return
    }

    const timer = window.setInterval(() => setRunClockNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [messages])

  React.useEffect(() => {
    setMentionIndex(0)
  }, [mentionState?.query, activeChannel])

  React.useEffect(() => {
    const mentionedIds = findMentionedRoleIds(draft, mentionableRoles)
    setSelectedTargetIds((current) => {
      if (current.length === mentionedIds.length && current.every((id, index) => id === mentionedIds[index])) {
        return current
      }

      return mentionedIds
    })
  }, [draft, mentionableRoles])

  React.useLayoutEffect(() => {
    const updateFrame = () => {
      const rect = mainRef.current?.getBoundingClientRect()
      if (!rect) return

      const visibleRight = Math.min(rect.right, window.innerWidth)
      const visibleBottom = Math.min(rect.bottom, window.innerHeight)
      setComposerFrame({
        left: Math.max(rect.left, 0),
        width: Math.max(320, visibleRight - Math.max(rect.left, 0)),
        bottom: Math.max(window.innerHeight - visibleBottom, 0),
      })
    }

    updateFrame()
    const resizeObserver = new ResizeObserver(updateFrame)
    if (mainRef.current) resizeObserver.observe(mainRef.current)
    window.addEventListener('resize', updateFrame)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateFrame)
    }
  }, [])

  const updateActiveMessages = React.useCallback((updater: (messages: CrewMessage[]) => CrewMessage[]) => {
    setBranches((prev) => prev.map((branch) => (
      branch.id === activeBranchId
        ? { ...branch, messages: updater(branch.messages) }
        : branch
    )))
  }, [activeBranchId])

  const updateMessageInBranch = React.useCallback((
    branchId: string,
    messageId: string,
    updater: (message: CrewMessage) => CrewMessage,
  ) => {
    setBranches((prev) => prev.map((branch) => (
      branch.id === branchId
        ? {
          ...branch,
          messages: branch.messages.map((message) => (
            message.id === messageId ? updater(message) : message
          )),
        }
        : branch
    )))
  }, [])

  const removeMessageInBranch = React.useCallback((branchId: string, messageId: string) => {
    setBranches((prev) => prev.map((branch) => (
      branch.id === branchId
        ? {
          ...branch,
          messages: branch.messages.filter((message) => message.id !== messageId),
        }
        : branch
    )))
  }, [])

  const refreshSkills = React.useCallback(async () => {
    if (!activeWorkspaceId) {
      return
    }

    try {
      const loaded = await window.electronAPI.refreshSkillCrewSkills(activeWorkspaceId, activeSessionWorkingDirectory)
      setSkills(loaded || [])
    } catch (error) {
      console.warn('[SkillCrew] Failed to refresh skills after skill run', error)
    }
  }, [activeSessionWorkingDirectory, activeWorkspaceId, setSkills])

  const loadSkillMoments = React.useCallback(async () => {
    if (!activeWorkspaceId) {
      setSkillMoments([])
      return
    }

    setSkillMomentsLoading(true)
    try {
      const result = await window.electronAPI.listSkillMoments({
        workspaceId: activeWorkspaceId,
        roomId: activeChannel,
        limit: 80,
      })
      setSkillMoments(result.moments)
    } catch (error) {
      console.warn('[SkillCrew] Failed to load Skill Moments', error)
    } finally {
      setSkillMomentsLoading(false)
    }
  }, [activeChannel, activeWorkspaceId])

  React.useEffect(() => {
    if (activeCrewSurface === 'chat') {
      return
    }

    void loadSkillMoments()
  }, [activeCrewSurface, loadSkillMoments])

  const runSkillMomentCycle = React.useCallback(async () => {
    if (!activeWorkspaceId || skillMomentsRunning) {
      return
    }

    const cycleRoles = mentionableRoles
      .filter((role) => !role.chairman && role.id !== 'skillcreator' && role.id !== 'hafuke')
      .slice(0, 8)

    setSkillMomentsRunning(true)
    try {
      const result = await window.electronAPI.runSkillMomentCycle({
        workspaceId: activeWorkspaceId,
        roomId: activeChannel,
        maxMoments: 3,
        maxCriticsPerMoment: 3,
        skills: cycleRoles.map((role) => ({
          id: role.id,
          name: role.name,
          handle: role.handle,
          description: role.description,
        })),
      })
      setSkillMomentsLastRunPath(result.path)
      setSkillMoments((current) => {
        const freshIds = new Set(result.moments.map((moment) => moment.id))
        return [
          ...result.moments,
          ...current.filter((moment) => !freshIds.has(moment.id)),
        ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      })
    } catch (error) {
      console.warn('[SkillCrew] Failed to run Skill Moments cycle', error)
    } finally {
      setSkillMomentsRunning(false)
    }
  }, [activeChannel, activeWorkspaceId, mentionableRoles, skillMomentsRunning])

  const updateSkillMomentFeedback = React.useCallback((
    target: SkillMomentFeedbackTarget,
    verdict: SkillFeedbackVerdict,
    savedPath: string,
  ) => {
    setSkillMoments((current) => current.map((moment) => {
      if (target.kind === 'moment' && moment.id === target.moment.id) {
        return {
          ...moment,
          feedbackVerdict: verdict,
          feedbackSavedPath: savedPath,
        }
      }

      if (target.kind === 'critique' && moment.id === target.moment.id) {
        return {
          ...moment,
          critiques: moment.critiques.map((critique) => (
            critique.id === target.critique.id
              ? {
                ...critique,
                feedbackVerdict: verdict,
                feedbackSavedPath: savedPath,
              }
              : critique
          )),
        }
      }

      return moment
    }))
  }, [])

  const recordSkillMomentFeedback = React.useCallback(async (
    target: SkillMomentFeedbackTarget,
    verdict: SkillFeedbackVerdict,
  ) => {
    if (!activeWorkspaceId) {
      return
    }

    const targetKey = feedbackTargetKey(target)
    const skillId = target.kind === 'critique' ? target.critique.criticSkillId : target.moment.skillId
    const skillName = target.kind === 'critique' ? target.critique.criticSkillName : target.moment.skillName
    const handle = target.kind === 'critique' ? target.critique.criticHandle : target.moment.handle
    const messageBody = target.kind === 'critique' ? target.critique.body : target.moment.body

    setSkillMomentFeedbackPendingKey(targetKey)
    try {
      const result = await window.electronAPI.recordSkillMomentFeedback({
        workspaceId: activeWorkspaceId,
        roomId: activeChannel,
        momentId: target.moment.id,
        critiqueId: target.kind === 'critique' ? target.critique.id : undefined,
        skillId,
        skillName,
        handle,
        verdict,
        messageBody,
        prompt: target.kind === 'critique' ? 'AgentOS critic feedback' : 'AgentOS moment feedback',
        sources: target.moment.sources,
        sourceLinks: target.moment.sources.map((source) => source.url),
        recordedAt: new Date().toISOString(),
      })
      updateSkillMomentFeedback(target, verdict, result.path)
    } catch (error) {
      console.warn('[SkillCrew] Failed to record Skill Moment feedback', error)
    } finally {
      setSkillMomentFeedbackPendingKey((current) => current === targetKey ? undefined : current)
    }
  }, [activeChannel, activeWorkspaceId, updateSkillMomentFeedback])

  const resolveSkillContent = React.useCallback(async (role: CrewRole): Promise<{ content: string; path?: string }> => {
    const slug = role.chairman ? 'chairman' : role.id

    if (activeWorkspaceId) {
      try {
        const result = await window.electronAPI.readSkillContent(
          activeWorkspaceId,
          slug,
          activeSessionWorkingDirectory,
        )
        return { content: result.content, path: result.path.replace(/\/SKILL\.md$/, '') }
      } catch (error) {
        console.warn(`[SkillCrew] Failed to read @${slug} from workspace skills`, error)
      }
    }

    if (role.skill?.content) {
      return {
        content: [
        `---`,
        `name: ${role.skill.metadata.name || role.skill.slug}`,
        `description: ${role.skill.metadata.description || ''}`,
        `---`,
        role.skill.content,
        ].join('\n'),
        path: role.skill.path,
      }
    }

    return {
      content: [
        `---`,
        `name: ${slug}`,
        `description: ${role.description}`,
        `---`,
        `You are ${role.name}. ${role.description}`,
      ].join('\n'),
    }
  }, [activeSessionWorkingDirectory, activeWorkspaceId])

  const runRoleWithModel = React.useCallback(async ({
    role,
    prompt,
    quote,
    branchId,
    messageId,
    selectedRoles,
  }: {
    role: CrewRole
    prompt: string
    quote?: CrewMessage
    branchId: string
    messageId: string
    selectedRoles: CrewRole[]
  }) => {
    if (!activeWorkspaceId) {
      updateMessageInBranch(branchId, messageId, (message) => ({
        ...message,
        body: '无法调用模型：当前没有 active workspace。',
        artifacts: ['skill_error'],
      }))
      return
    }

    try {
      const skill = await resolveSkillContent(role)
      const invocationPrompt = buildSkillInvocationPrompt({
        role,
        prompt,
        quote,
        activeChannel,
        selectedRoles,
        skillContent: skill.content,
        skillDirectoryPath: skill.path,
      })
      const runStartedAt = Date.now()
      const contextChars = invocationPrompt.length
      const contextTokensEstimate = estimateTokens(invocationPrompt)

      updateMessageInBranch(branchId, messageId, (message) => ({
        ...message,
        body: '已把 SKILL.md 和用户请求交给 Codex OAuth 会话，等待回复...',
        artifacts: ['codex_oauth_invoked', 'model_pending'],
        runStartedAt,
        runEndedAt: undefined,
        elapsedMs: undefined,
        contextChars,
        contextTokensEstimate,
      }))

      const result = await window.electronAPI.runCodexSkill({
        prompt: invocationPrompt,
        workingDirectory: inferSkillWorkspaceRoot(skill.path) ?? activeSessionWorkingDirectory,
        timeoutMs: role.id === 'skillcreator' ? 0 : 3_000_000,
        reasoningEffort: 'xhigh',
      })
      await refreshSkills()

      if (result.success && result.text?.trim()) {
        const replyText = result.text.trim()
        if (isSkillSilenceReply(replyText)) {
          removeMessageInBranch(branchId, messageId)
          return
        }

        const runEndedAt = Date.now()
        updateMessageInBranch(branchId, messageId, (message) => ({
          ...message,
          body: normalizeSkillReplyText(replyText),
          artifacts: ['codex_oauth_reply', 'skill_reply'],
          runEndedAt,
          elapsedMs: runEndedAt - runStartedAt,
        }))
        return
      }

      const errorText = result.error || result.stderr || result.stdout || 'Codex CLI 没有返回可用文本。'
      const runEndedAt = Date.now()
      updateMessageInBranch(branchId, messageId, (message) => ({
        ...message,
        body: [
          makeSkillFallbackReply(role, prompt, errorText),
          result.logPath ? `调试日志: ${result.logPath}` : '',
        ].filter(Boolean).join('\n\n'),
        artifacts: ['skill_error', 'skill_fallback', 'codex_oauth_error'],
        runEndedAt,
        elapsedMs: runEndedAt - runStartedAt,
      }))
    } catch (error) {
      updateMessageInBranch(branchId, messageId, (message) => ({
        ...message,
        body: makeSkillFallbackReply(role, prompt, error instanceof Error ? error.message : String(error)),
        artifacts: ['skill_error', 'skill_fallback', 'codex_oauth_error'],
      }))
    }
  }, [activeChannel, activeSessionWorkingDirectory, activeWorkspaceId, refreshSkills, removeMessageInBranch, resolveSkillContent, updateMessageInBranch])

  const runModelSelfWithCodex = React.useCallback(async ({
    prompt,
    quote,
    branchId,
    messageId,
  }: {
    prompt: string
    quote?: CrewMessage
    branchId: string
    messageId: string
  }) => {
    if (!activeWorkspaceId) {
      updateMessageInBranch(branchId, messageId, (message) => ({
        ...message,
        body: makeModelSelfReply(prompt, quote),
        artifacts: ['model_self_reply', 'model_fallback'],
      }))
      return
    }

    try {
      const invocationPrompt = buildModelSelfInvocationPrompt({
        prompt,
        quote,
        activeChannel,
      })
      const runStartedAt = Date.now()
      const contextChars = invocationPrompt.length
      const contextTokensEstimate = estimateTokens(invocationPrompt)

      updateMessageInBranch(branchId, messageId, (message) => ({
        ...message,
        body: '未检测到有效 @skill，已把用户请求交给 Codex OAuth 会话，等待模型自身回复...',
        artifacts: ['codex_oauth_invoked', 'model_pending', 'model_self_pending'],
        runStartedAt,
        runEndedAt: undefined,
        elapsedMs: undefined,
        contextChars,
        contextTokensEstimate,
      }))

      const result = await window.electronAPI.runCodexSkill({
        prompt: invocationPrompt,
        workingDirectory: activeSessionWorkingDirectory,
        timeoutMs: 3_000_000,
        reasoningEffort: 'xhigh',
      })

      if (result.success && result.text?.trim()) {
        const runEndedAt = Date.now()
        updateMessageInBranch(branchId, messageId, (message) => ({
          ...message,
          body: result.text!.trim(),
          artifacts: ['codex_oauth_reply', 'model_self_reply'],
          runEndedAt,
          elapsedMs: runEndedAt - runStartedAt,
        }))
        return
      }

      const errorText = result.error || result.stderr || result.stdout || 'Codex CLI 没有返回可用文本。'
      const runEndedAt = Date.now()
      updateMessageInBranch(branchId, messageId, (message) => ({
        ...message,
        body: [
          `模型连接暂不可用：${errorText.length > 180 ? `${errorText.slice(0, 180)}...` : errorText}`,
          '以下是本地降级发言：未执行真实模型自身回答。',
          '',
          makeModelSelfReply(prompt, quote),
          result.logPath ? `调试日志: ${result.logPath}` : '',
        ].filter(Boolean).join('\n\n'),
        artifacts: ['model_self_reply', 'model_fallback', 'codex_oauth_error'],
        runEndedAt,
        elapsedMs: runEndedAt - runStartedAt,
      }))
    } catch (error) {
      updateMessageInBranch(branchId, messageId, (message) => ({
        ...message,
        body: [
          `模型连接暂不可用：${error instanceof Error ? error.message : String(error)}`,
          '以下是本地降级发言：未执行真实模型自身回答。',
          '',
          makeModelSelfReply(prompt, quote),
        ].join('\n\n'),
        artifacts: ['model_self_reply', 'model_fallback', 'codex_oauth_error'],
      }))
    }
  }, [activeChannel, activeSessionWorkingDirectory, activeWorkspaceId, updateMessageInBranch])

  const updateDraftAndMentionState = React.useCallback((value: string, cursor: number) => {
    setDraft(value)
    setMentionState(parseMentionState(value, cursor))
  }, [])

  const selectMentionRole = React.useCallback((role: CrewRole) => {
    const textarea = textareaRef.current
    const cursor = textarea?.selectionStart ?? draft.length
    const state = mentionState ?? parseMentionState(draft, cursor)
    if (!state) {
      return
    }

    const before = draft.slice(0, state.start)
    const after = draft.slice(cursor)
    const insertion = `${role.handle} `
    const nextDraft = `${before}${insertion}${after}`
    const nextCursor = before.length + insertion.length

    setDraft(nextDraft)
    setMentionState(null)
    setSelectedTargetIds((current) => current.includes(role.id) ? current : [...current, role.id])
    window.requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(nextCursor, nextCursor)
    })
  }, [draft, mentionState])

  const sendMessage = React.useCallback(() => {
    const text = draft.trim()
    if (!text) return

    const now = formatTime()
    const branchId = activeBranchId
    const userMessage: CrewMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      author: 'You',
      body: text,
      timestamp: now,
      quoteId,
    }

    const typedTargetIds = findMentionedRoleIds(text, mentionableRoles)
    const selectedIds = Array.from(new Set([...selectedTargetIds, ...typedTargetIds]))
      .filter((id) => roles.some((role) => role.id === id))
    const selectedRoles = selectedIds
      .map((id) => roles.find((role) => role.id === id))
      .filter((role): role is CrewRole => Boolean(role))
    const prompt = cleanSelectedPrompt(text, selectedRoles)
    const hasChairman = selectedIds.includes('__chairman__')
    const explicitTargets = selectedIds
      .filter((id) => id !== '__chairman__')
      .map((id) => roles.find((role) => role.id === id))
      .filter((role): role is CrewRole => Boolean(role))

    const targets = hasChairman
      ? (explicitTargets.length > 0 ? explicitTargets : mentionableRoles.filter((role) => !role.chairman).slice(0, 4))
      : explicitTargets

    const chairmanRole = roles.find((role) => role.chairman)
    const executionRoles = hasChairman && chairmanRole
      ? [...targets, chairmanRole]
      : targets

    const replies: CrewMessage[] = []
    const modelRuns: Array<{ role: CrewRole; messageId: string }> = []
    let modelSelfMessageId: string | undefined
    for (const role of executionRoles) {
      const messageId = `agent-${role.id}-${Date.now()}-${replies.length}`
      replies.push({
        id: messageId,
        role: role.chairman ? 'chairman' : 'agent',
        author: role.name,
        handle: role.handle,
        skillId: role.chairman ? 'chairman' : role.id,
        body: '正在准备调用模型...',
        timestamp: now,
        quoteId: quote?.id,
        artifacts: ['skill_task_packet', 'model_pending'],
      })
      modelRuns.push({ role, messageId })
    }

    if (!hasChairman && replies.length === 0) {
      modelSelfMessageId = `model-${Date.now()}`
      replies.push({
        id: modelSelfMessageId,
        role: 'agent',
        author: '模型自身',
        handle: '@model',
        body: '正在准备调用模型自身...',
        timestamp: now,
        quoteId: quote?.id,
        artifacts: ['model_pending', 'model_self_pending'],
      })
    }

    updateActiveMessages((prev) => [...prev, userMessage, ...replies])
    for (const run of modelRuns) {
      void runRoleWithModel({
        role: run.role,
        prompt,
        quote,
        branchId,
        messageId: run.messageId,
        selectedRoles,
      })
    }
    if (modelSelfMessageId) {
      void runModelSelfWithCodex({
        prompt,
        quote,
        branchId,
        messageId: modelSelfMessageId,
      })
    }
    setDraft('')
    setMentionState(null)
    setSelectedTargetIds([])
    setQuoteId(undefined)
  }, [activeBranchId, draft, mentionableRoles, quote, quoteId, roles, runModelSelfWithCodex, runRoleWithModel, selectedTargetIds, updateActiveMessages])

  const copyMessage = React.useCallback(async (message: CrewMessage) => {
    await navigator.clipboard.writeText(buildMessageClipboardText(message))
    setCopiedId(message.id)
    window.setTimeout(() => setCopiedId((current) => current === message.id ? undefined : current), 1200)
  }, [])

  const copyCurrentBranch = React.useCallback(async () => {
    if (!activeBranch) return
    await navigator.clipboard.writeText(buildBranchClipboardText(activeBranch))
    setCopiedId(activeBranch.id)
    window.setTimeout(() => setCopiedId((current) => current === activeBranch.id ? undefined : current), 1200)
  }, [activeBranch])

  const exportConversationMarkdown = React.useCallback(() => {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    downloadMarkdown(
      `skill-crew-${formatChannelLabel(activeChannel)}-${timestamp}.md`,
      buildConversationMarkdown(branches, activeChannel)
    )
  }, [activeChannel, branches])

  const recordSkillFeedback = React.useCallback(async (message: CrewMessage, verdict: SkillFeedbackVerdict) => {
    if (!activeWorkspaceId || !message.skillId) {
      return
    }

    const messageIndex = messages.findIndex((entry) => entry.id === message.id)
    const previousUserMessage = messageIndex >= 0
      ? messages.slice(0, messageIndex).reverse().find((entry) => entry.role === 'user')
      : undefined
    const option = skillFeedbackOptions.find((entry) => entry.verdict === verdict)

    setFeedbackPendingId(message.id)
    try {
      const result = await window.electronAPI.recordSkillFeedback({
        workspaceId: activeWorkspaceId,
        skillId: message.skillId,
        skillName: message.author,
        handle: message.handle,
        verdict,
        channel: activeChannel,
        branchId: activeBranchId,
        messageId: message.id,
        messageBody: message.body,
        prompt: previousUserMessage?.body,
        artifacts: message.artifacts ?? [],
        recordedAt: new Date().toISOString(),
      })

      updateMessageInBranch(activeBranchId, message.id, (current) => {
        const currentArtifacts = current.artifacts ?? []
        const nextArtifacts = [
          ...currentArtifacts.filter((artifact) => (
            !artifact.startsWith('feedback_') && artifact !== 'skill_feedback_recorded' && artifact !== 'skill_feedback_error'
          )),
          option?.artifact ?? 'feedback_recorded',
          'skill_feedback_recorded',
        ]

        return {
          ...current,
          feedbackVerdict: verdict,
          feedbackSavedPath: result.path,
          artifacts: nextArtifacts,
        }
      })
    } catch (error) {
      console.warn('[SkillCrew] Failed to record skill feedback', error)
      updateMessageInBranch(activeBranchId, message.id, (current) => ({
        ...current,
        artifacts: [
          ...(current.artifacts ?? []).filter((artifact) => artifact !== 'skill_feedback_error'),
          'skill_feedback_error',
        ],
      }))
    } finally {
      setFeedbackPendingId((current) => current === message.id ? undefined : current)
    }
  }, [activeBranchId, activeChannel, activeWorkspaceId, messages, updateMessageInBranch])

  const branchFromMessage = React.useCallback((message: CrewMessage) => {
    const sourceMessages = messages.slice(0, messages.findIndex((entry) => entry.id === message.id) + 1)
    const nextId = `branch-${Date.now()}`
    const title = `branch ${branches.length}`
    const branchNote: CrewMessage = {
      id: `branch-note-${Date.now()}`,
      role: 'chairman',
      author: '董事长',
      handle: '@董事长',
      body: `已从 ${message.author} 的发言开启新对话分支。这个分支保留源上下文，可以继续追问、分歧扩展或让其他 skill 接手。`,
      timestamp: formatTime(),
      quoteId: message.id,
      artifacts: ['branch_root', 'conversation_fork'],
    }

    setBranches((prev) => [
      ...prev,
      {
        id: nextId,
        title,
        sourceMessageId: message.id,
        messages: [...(sourceMessages.length > 0 ? sourceMessages : messages), branchNote],
      },
    ])
    setActiveBranchId(nextId)
    setQuoteId(message.id)
    setDraft('基于这个分支继续追问：')
  }, [branches.length, messages])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <PanelHeader
        title={`#${formatChannelLabel(activeChannel)}`}
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className="inline-flex items-center gap-1 rounded-[6px] border border-border/60 bg-background px-2 py-1"
              title="本地编排模式：在本机解析 @skill、读取本地 SKILL.md，并通过 Codex CLI/OAuth 发起调用。不是云端在线状态。"
            >
              <Radio className="h-3 w-3 text-emerald-500" />
              local orchestration
            </span>
          </div>
        }
      />

      <div className="grid h-full min-h-0 max-h-full flex-1 overflow-hidden grid-cols-[minmax(0,1fr)_240px] border-t border-border/50 max-[980px]:grid-cols-1">
        <main ref={mainRef} className="flex h-full min-h-0 max-h-full flex-col overflow-hidden">
          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-4">
            {[
              { id: 'chat', label: '聊天' },
              { id: 'moments', label: '朋友圈' },
              { id: 'agentos', label: 'AgentOS' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveCrewSurface(tab.id as typeof activeCrewSurface)}
                className={cn(
                  'inline-flex h-8 items-center rounded-[7px] px-3 text-sm transition-colors',
                  activeCrewSurface === tab.id
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeCrewSurface === 'chat' ? (
            <>
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-5 pb-28">
              <div className="border-b border-border/60 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-foreground text-background">
                    <Crown className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-lg font-semibold tracking-tight text-foreground">Skill Crew War Room</div>
                    <div className="text-sm text-muted-foreground">
                      @skill 调用指定 skill；不 @ 则由模型自身回答；@董事长 召集多 skill。
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Branches
                  </span>
                  {branches.map((branch) => (
                    <button
                      key={branch.id}
                      type="button"
                      onClick={() => {
                        setActiveBranchId(branch.id)
                        setQuoteId(undefined)
                      }}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-[6px] border px-2 text-xs transition-colors',
                        branch.id === activeBranchId
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border/70 bg-background text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
                      )}
                    >
                      <GitBranch className="h-3.5 w-3.5" />
                      {branch.title}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => void copyCurrentBranch()}
                    className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-border/70 bg-background px-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                  >
                    {copiedId === activeBranch?.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedId === activeBranch?.id ? 'copied' : 'copy branch'}
                  </button>
                  <button
                    type="button"
                    onClick={exportConversationMarkdown}
                    className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-border/70 bg-background px-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    export md
                  </button>
                </div>
              </div>

              {messages.map((message) => {
                const quotedMessage = message.quoteId ? messages.find((entry) => entry.id === message.quoteId) : undefined
                const canRecordFeedback = Boolean(
                  message.skillId
                  && message.role !== 'user'
                  && !message.artifacts?.includes('model_pending')
                )
                return (
                  <article key={message.id} className="group flex gap-3">
                    <Avatar message={message} roles={roles} workspaceId={avatarWorkspaceId} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-foreground">{message.author}</span>
                        {message.handle && <span className="text-xs text-muted-foreground">{message.handle}</span>}
                        <span className="text-[11px] text-muted-foreground">{message.timestamp}</span>
                      </div>
                      {quotedMessage && (
                        <div className="mt-1 rounded-[6px] border-l-2 border-foreground/30 bg-foreground/[0.035] px-2 py-1 text-xs text-muted-foreground">
                          {quotedMessage.author}: {quotedMessage.body.slice(0, 140)}
                        </div>
                      )}
                      <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                        {message.body}
                      </div>
                      {buildRunMetaParts(message, runClockNow).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {buildRunMetaParts(message, runClockNow).map((part) => (
                            <span key={part} className="rounded-[5px] bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                              {part}
                            </span>
                          ))}
                        </div>
                      )}
                      {message.artifacts && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {message.artifacts.map((artifact) => (
                            <span key={artifact} className="rounded-[5px] bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {artifact}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <MessageActionButton
                          icon={<MessageSquareQuote className="h-3 w-3" />}
                          label="引用"
                          onClick={() => setQuoteId(message.id)}
                        />
                        <MessageActionButton
                          icon={copiedId === message.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          label={copiedId === message.id ? '已复制' : '复制'}
                          onClick={() => void copyMessage(message)}
                        />
                        <MessageActionButton
                          icon={<GitBranch className="h-3 w-3" />}
                          label="新分支"
                          onClick={() => branchFromMessage(message)}
                        />
                      </div>
                      {canRecordFeedback && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="mr-0.5">本次表现</span>
                          {skillFeedbackOptions.map((option) => {
                            const selected = message.feedbackVerdict === option.verdict
                            return (
                              <button
                                key={option.verdict}
                                type="button"
                                disabled={feedbackPendingId === message.id}
                                onClick={() => void recordSkillFeedback(message, option.verdict)}
                                className={cn(
                                  'inline-flex h-6 items-center rounded-[5px] border px-2 transition-colors disabled:cursor-wait disabled:opacity-60',
                                  selected
                                    ? 'border-foreground bg-foreground text-background'
                                    : 'border-border/50 bg-background hover:bg-foreground/[0.04] hover:text-foreground'
                                )}
                                title={selected && message.feedbackSavedPath ? `已记录到 ${message.feedbackSavedPath}` : '记录这次 skill 对话体验'}
                              >
                                {option.label}
                              </button>
                            )
                          })}
                          {message.feedbackSavedPath && (
                            <span className="rounded-[5px] bg-foreground/[0.06] px-1.5 py-0.5">
                              已记录
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          <div
            className="z-50 shrink-0 border-t border-border/60 bg-background px-4 py-3 shadow-[0_-12px_24px_rgba(0,0,0,0.04)]"
            style={composerFrame ? {
              position: 'fixed',
              left: composerFrame.left,
              width: composerFrame.width,
              bottom: composerFrame.bottom,
            } : undefined}
          >
            <div className="mx-auto max-w-4xl">
              {quote && (
                <div className="mb-2 flex items-start gap-2 rounded-[7px] bg-foreground/[0.04] px-2 py-1.5 text-xs text-muted-foreground">
                  <MessageSquareQuote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">引用 {quote.author}: {quote.body}</span>
                  <button type="button" onClick={() => setQuoteId(undefined)} className="rounded-[4px] p-0.5 hover:bg-foreground/[0.08]">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {selectedTargets.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {selectedTargets.map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() => {
                        const nextDraft = removeMentionHandle(draft, target.handle)
                        setDraft(nextDraft)
                        setMentionState(parseMentionState(nextDraft, textareaRef.current?.selectionStart ?? nextDraft.length))
                        setSelectedTargetIds((current) => current.filter((id) => id !== target.id))
                        window.requestAnimationFrame(() => textareaRef.current?.focus())
                      }}
                      className={cn(
                        'inline-flex h-6 items-center gap-1 rounded-[5px] border px-2 text-xs transition-colors',
                        target.chairman
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                          : 'border-foreground/15 bg-foreground/[0.06] text-foreground'
                      )}
                      title="点击移除这个唤醒目标"
                    >
                      {target.chairman ? <Crown className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                      {target.handle}
                      <X className="h-3 w-3 opacity-60" />
                    </button>
                  ))}
                </div>
              )}
              <div className="relative flex items-end gap-2 rounded-[8px] border border-border/70 bg-background shadow-minimal">
                {mentionState && filteredMentionRoles.length > 0 && (
                  <div className="absolute bottom-[calc(100%+8px)] left-2 z-50 w-[min(360px,calc(100vw-80px))] overflow-hidden rounded-[8px] border border-border/70 bg-background shadow-lg">
                    <div className="border-b border-border/50 px-2 py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                      #{formatChannelLabel(activeChannel)} local variables
                    </div>
                    <div className="max-h-64 overflow-auto p-1">
                      {filteredMentionRoles.map((role, index) => {
                        const isActive = index === mentionIndex
                        const isSelected = selectedTargetIds.includes(role.id)
                        return (
                          <button
                            key={role.id}
                            type="button"
                            onMouseEnter={() => setMentionIndex(index)}
                            onClick={() => selectMentionRole(role)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors',
                              isActive ? 'bg-foreground text-background' : 'hover:bg-foreground/[0.05]',
                              isSelected && !isActive ? 'bg-foreground/[0.08]' : ''
                            )}
                          >
                            <span className={cn(
                              'grid size-7 shrink-0 place-items-center rounded-[6px]',
                              role.chairman
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                : isActive ? 'bg-background/15 text-background' : 'bg-muted text-muted-foreground'
                            )}>
                              {role.chairman ? <Crown className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{role.handle}</span>
                              <span className={cn('block truncate text-[11px]', isActive ? 'text-background/70' : 'text-muted-foreground')}>
                                {role.description}
                              </span>
                            </span>
                            {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => updateDraftAndMentionState(event.target.value, event.target.selectionStart)}
                  onKeyDown={(event) => {
                    if (mentionState && filteredMentionRoles.length > 0) {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        setMentionIndex((current) => (current + 1) % filteredMentionRoles.length)
                        return
                      }
                      if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        setMentionIndex((current) => (current - 1 + filteredMentionRoles.length) % filteredMentionRoles.length)
                        return
                      }
                      if (event.key === 'Enter' || event.key === 'Tab') {
                        event.preventDefault()
                        selectMentionRole(filteredMentionRoles[mentionIndex] ?? filteredMentionRoles[0])
                        return
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setMentionState(null)
                        return
                      }
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      sendMessage()
                    }
                  }}
                  className="max-h-36 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-3 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="输入 @ 从当前文件夹选择 skill；不选则用模型自身回答。"
                />
                <Button
                  type="button"
                  size="icon"
                  onClick={sendMessage}
                  className="mb-1.5 mr-1.5 h-8 w-8 rounded-[7px]"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
            </>
          ) : (
            <SkillMomentsView
              mode={activeCrewSurface}
              workspaceId={avatarWorkspaceId}
              roomLabel={formatChannelLabel(activeChannel)}
              moments={skillMoments}
              roles={roles}
              loading={skillMomentsLoading}
              running={skillMomentsRunning}
              lastRunPath={skillMomentsLastRunPath}
              pendingFeedbackKey={skillMomentFeedbackPendingKey}
              onRefresh={() => void runSkillMomentCycle()}
              onFeedback={(target, verdict) => void recordSkillMomentFeedback(target, verdict)}
            />
          )}
        </main>

        <aside className="border-l border-border/60 bg-foreground/[0.015] max-[980px]:hidden">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-medium">
              <Users className="h-4 w-4" />
              Members
              <span className="ml-auto rounded-[5px] bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {mentionableRoles.length}
              </span>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-1 p-3">
                <div className="flex items-center gap-2 rounded-[7px] px-2 py-1.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-foreground text-background text-xs font-semibold">
                    You
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">You</div>
                    <div className="text-[11px] text-muted-foreground">owner</div>
                  </div>
                </div>
                {mentionableRoles.map((role) => (
                  <div key={role.id} className="flex items-center gap-2 rounded-[7px] px-2 py-1.5">
                    {role.skill ? (
                      <SkillAvatar skill={role.skill} size="sm" className="h-8 w-8" workspaceId={avatarWorkspaceId} />
                    ) : (
                      <span className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-[7px]',
                        role.chairman ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-foreground/[0.06] text-muted-foreground'
                      )}>
                        {role.chairman ? <Crown className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{role.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{role.description}</div>
                    </div>
                    <Sparkles className="h-3.5 w-3.5 text-muted-foreground/60" />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </aside>
      </div>
    </div>
  )
}

function MessageActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-6 items-center gap-1 rounded-[5px] border border-border/50 bg-background px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
    >
      {icon}
      {label}
    </button>
  )
}

function Avatar({ message, roles, workspaceId }: { message: CrewMessage; roles: CrewRole[]; workspaceId?: string }) {
  if (message.role === 'user') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-foreground text-background text-xs font-semibold">
        You
      </span>
    )
  }

  const role = roles.find((entry) => entry.name === message.author || entry.handle === message.handle)
  if (role?.skill) {
    return <SkillAvatar skill={role.skill} size="md" className="h-10 w-10 shrink-0" workspaceId={workspaceId} />
  }

  return (
    <span className={cn(
      'flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]',
      message.role === 'chairman' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-foreground/[0.06] text-muted-foreground'
    )}>
      {message.role === 'chairman' ? <Crown className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
    </span>
  )
}
