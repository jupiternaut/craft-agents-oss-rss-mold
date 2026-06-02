import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  Bot,
  Check,
  Copy,
  Crown,
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
import { cn } from '@/lib/utils'
import type { LoadedSkill } from '../../shared/types'
import {
  DEFAULT_SKILL_CREW_ROOMS,
  inferSkillCrewRoomId,
  inferSkillPhysicalFolderId,
  skillCrewPlacementAtom,
} from '@/atoms/skill-crew'

type CrewRole = {
  id: string
  name: string
  handle: string
  description: string
  skill?: LoadedSkill
  chairman?: boolean
}

type CrewMessage = {
  id: string
  role: 'user' | 'agent' | 'chairman' | 'system'
  author: string
  handle?: string
  body: string
  timestamp: string
  quoteId?: string
  artifacts?: string[]
}

type CrewBranch = {
  id: string
  title: string
  sourceMessageId?: string
  messages: CrewMessage[]
}

type ComposerFrame = {
  left: number
  width: number
  bottom: number
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
  const loaded = skills.map((skill): CrewRole => ({
    id: skill.slug,
    name: skill.metadata.name || skill.slug,
    handle: `@${skill.slug}`,
    description: skill.metadata.description || '本地 Craft skill',
    skill,
  }))

  return [
    {
      id: '__chairman__',
      name: '董事长',
      handle: '@董事长',
      description: '召集 skill、安排轮次、压缩分歧并给出下一步。',
      chairman: true,
    },
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

function makeAgentReply(role: CrewRole, prompt: string, quote?: CrewMessage): string {
  const quoteLine = quote ? `我先接住引用里的上下文：“${quote.body.slice(0, 80)}”。` : ''
  return [
    quoteLine,
    `我的角色边界是：${role.description}`,
    `针对“${prompt || '这个议题'}”，我会先给出本角色视角，而不是替整个团队做结论。`,
    '下一步需要把这个观点转成可引用 artifact，再交给董事长压缩分歧。',
  ].filter(Boolean).join('\n')
}

function makeModelSelfReply(prompt: string, quote?: CrewMessage): string {
  const quoteLine = quote ? `我先接住引用里的上下文：“${quote.body.slice(0, 80)}”。` : ''
  return [
    quoteLine,
    '未检测到从下拉菜单选中的 @skill，我按模型自身直接回答。手打 @ 文本不会触发 skill，避免输错名字误唤醒。',
    `针对“${prompt || '这个议题'}”，我先给出通用判断；如果你从 @ 菜单选中某个 skill，我再切换到那个 skill 的角色边界和工作方式。`,
  ].filter(Boolean).join('\n')
}

function seedMessages(): CrewMessage[] {
  return [
    {
      id: 'seed-1',
      role: 'chairman',
      author: '董事长',
      handle: '@董事长',
      body: '这里是 Skill Crew 工作区。你可以直接 @skill 提问，也可以 @董事长 召集多个 skill 讨论、辩论、归纳。',
      timestamp: formatTime(),
      artifacts: ['channel_bootstrap', 'chairman_protocol'],
    },
    {
      id: 'seed-2',
      role: 'agent',
      author: 'skillcreator',
      handle: '@skillcreator',
      body: '我负责把自然语言里的“人”提炼成可复用 skill：角色边界、醒来条件、发言方式、交接工件。',
      timestamp: formatTime(),
      artifacts: ['persona_contract'],
    },
  ]
}

function buildMessageClipboardText(message: CrewMessage) {
  return [
    `${message.author}${message.handle ? ` ${message.handle}` : ''} ${message.timestamp}`,
    message.body,
    message.artifacts?.length ? `Artifacts: ${message.artifacts.join(', ')}` : '',
  ].filter(Boolean).join('\n')
}

function buildBranchClipboardText(branch: CrewBranch) {
  return branch.messages.map(buildMessageClipboardText).join('\n\n---\n\n')
}

function roleBelongsToChannel(role: CrewRole, activeChannel: string, placement: Record<string, string>) {
  if (role.chairman) {
    return true
  }

  if (!role.skill) {
    return false
  }

  const knownFolderIds = Array.from(new Set([
    activeChannel,
    ...DEFAULT_SKILL_CREW_ROOMS,
    ...Object.values(placement),
  ]))
  const folderId = placement[role.id] ?? inferSkillPhysicalFolderId(role.skill, knownFolderIds) ?? inferSkillCrewRoomId(role.skill)
  return folderId === activeChannel || activeChannel === 'chairman'
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

export default function SkillCrewPage() {
  const skills = useAtomValue(skillsAtom)
  const activeChannel = useAtomValue(skillCrewChannelAtom)
  const skillPlacement = useAtomValue(skillCrewPlacementAtom)
  const roles = React.useMemo(() => buildRoles(skills), [skills])
  const mentionableRoles = React.useMemo(
    () => roles.filter((role) => roleBelongsToChannel(role, activeChannel, skillPlacement)),
    [activeChannel, roles, skillPlacement],
  )
  const [branches, setBranches] = React.useState<CrewBranch[]>(() => [
    { id: 'main', title: 'main', messages: seedMessages() },
  ])
  const [activeBranchId, setActiveBranchId] = React.useState('main')
  const [draft, setDraft] = React.useState('')
  const [quoteId, setQuoteId] = React.useState<string | undefined>()
  const [copiedId, setCopiedId] = React.useState<string | undefined>()
  const [selectedTargetIds, setSelectedTargetIds] = React.useState<string[]>([])
  const [mentionState, setMentionState] = React.useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = React.useState(0)
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
    scrollRef.current?.scrollIntoView({ block: 'end' })
  }, [activeBranchId, messages.length])

  React.useEffect(() => {
    setMentionIndex(0)
  }, [mentionState?.query, activeChannel])

  React.useEffect(() => {
    const availableIds = new Set(mentionableRoles.map((role) => role.id))
    setSelectedTargetIds((current) => current.filter((id) => availableIds.has(id)))
  }, [mentionableRoles])

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
    const userMessage: CrewMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      author: 'You',
      body: text,
      timestamp: now,
      quoteId,
    }

    const selectedIds = selectedTargetIds.filter((id) => roles.some((role) => role.id === id))
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

    const replies: CrewMessage[] = []
    for (const role of targets) {
      replies.push({
        id: `agent-${role.id}-${Date.now()}-${replies.length}`,
        role: role.chairman ? 'chairman' : 'agent',
        author: role.name,
        handle: role.handle,
        body: makeAgentReply(role, prompt, quote),
        timestamp: now,
        quoteId: quote?.id,
        artifacts: ['skill_task_packet', 'skill_reply'],
      })
    }

    if (hasChairman) {
      replies.push({
        id: `chairman-${Date.now()}`,
        role: 'chairman',
        author: '董事长',
        handle: '@董事长',
        body: [
          `已召集：${targets.map((role) => role.handle).join('、') || '默认核心 crew'}`,
          `议题：${prompt || '未命名议题'}`,
          '阶段结论：先保留各 skill 原始发言；下一轮只追问分歧最大的点；需要执行时指定主责 skill 和产物格式。',
        ].join('\n'),
        timestamp: now,
        quoteId: quote?.id,
        artifacts: ['chairman_synthesis'],
      })
    }

    if (!hasChairman && replies.length === 0) {
      replies.push({
        id: `model-${Date.now()}`,
        role: 'agent',
        author: '模型自身',
        handle: '@model',
        body: makeModelSelfReply(prompt, quote),
        timestamp: now,
        quoteId: quote?.id,
        artifacts: ['model_self_reply'],
      })
    }

    updateActiveMessages((prev) => [...prev, userMessage, ...replies])
    setDraft('')
    setMentionState(null)
    setSelectedTargetIds([])
    setQuoteId(undefined)
  }, [draft, mentionableRoles, quote, quoteId, roles, selectedTargetIds, updateActiveMessages])

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
            <span className="inline-flex items-center gap-1 rounded-[6px] border border-border/60 bg-background px-2 py-1">
              <Radio className="h-3 w-3 text-emerald-500" />
              local orchestration
            </span>
          </div>
        }
      />

      <div className="grid h-full min-h-0 max-h-full flex-1 overflow-hidden grid-cols-[minmax(0,1fr)_240px] border-t border-border/50 max-[980px]:grid-cols-1">
        <main ref={mainRef} className="flex h-full min-h-0 max-h-full flex-col overflow-hidden">
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
                </div>
              </div>

              {messages.map((message) => {
                const quotedMessage = message.quoteId ? messages.find((entry) => entry.id === message.quoteId) : undefined
                return (
                  <article key={message.id} className="group flex gap-3">
                    <Avatar message={message} roles={roles} />
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
                      onClick={() => setSelectedTargetIds((current) => current.filter((id) => id !== target.id))}
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
                  className="max-h-36 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-3 text-sm leading-5 outline-none placeholder:text-muted-foreground"
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
        </main>

        <aside className="border-l border-border/60 bg-foreground/[0.015] max-[980px]:hidden">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-medium">
              <Users className="h-4 w-4" />
              Members
              <span className="ml-auto rounded-[5px] bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {roles.length + 1}
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
                {roles.map((role) => (
                  <div key={role.id} className="flex items-center gap-2 rounded-[7px] px-2 py-1.5">
                    {role.skill ? (
                      <SkillAvatar skill={role.skill} size="sm" />
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

function Avatar({ message, roles }: { message: CrewMessage; roles: CrewRole[] }) {
  if (message.role === 'user') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-foreground text-background text-xs font-semibold">
        You
      </span>
    )
  }

  const role = roles.find((entry) => entry.name === message.author || entry.handle === message.handle)
  if (role?.skill) {
    return <SkillAvatar skill={role.skill} size="md" className="shrink-0" />
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
