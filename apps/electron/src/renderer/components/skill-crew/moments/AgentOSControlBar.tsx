import * as React from 'react'
import { Check, Loader2, Play, RefreshCw, Radio, Settings2, SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  SkillMomentStageControl,
  SkillMomentStageControlLevel,
  SkillMomentStageMediaPolicy,
  SkillMomentStageSceneType,
} from '../../../../shared/types'
import type { SkillMomentRole } from './types'

type AgentOSControlBarProps = {
  roomLabel: string
  roomId: string
  mode: 'moments' | 'agentos'
  running: boolean
  loading: boolean
  momentCount: number
  criticCount: number
  lastRunPath?: string
  roles: SkillMomentRole[]
  onReload: () => void
  onGenerate: (stageControl?: SkillMomentStageControl) => void
}

const controlLevelOptions: Array<{ value: SkillMomentStageControlLevel; label: string }> = [
  { value: 'human_locked', label: '人工锁定' },
  { value: 'human_guided', label: '人工引导' },
  { value: 'free_actor', label: '自由演员' },
]

const sceneOptions: Array<{ value: SkillMomentStageSceneType; label: string }> = [
  { value: 'friend_circle', label: '朋友圈' },
  { value: 'tavern', label: '酒馆' },
  { value: 'edict_council', label: '朝堂' },
  { value: 'screenplay', label: '剧本房' },
]

const mediaPolicyOptions: Array<{ value: SkillMomentStageMediaPolicy; label: string }> = [
  { value: 'allow_one_image_if_author_requests', label: '需要时一张图' },
  { value: 'allow_actor_requested_images', label: '允许角色要图' },
  { value: 'disabled', label: '不生图' },
]

function defaultSceneType(roomId: string): SkillMomentStageSceneType {
  return roomId === 'screenplay' ? 'screenplay' : 'friend_circle'
}

function roleSlug(role: SkillMomentRole): string {
  return role.handle.replace(/^@/, '').trim().toLocaleLowerCase()
}

export function AgentOSControlBar({
  roomLabel,
  roomId,
  mode,
  running,
  loading,
  momentCount,
  criticCount,
  lastRunPath,
  roles,
  onReload,
  onGenerate,
}: AgentOSControlBarProps) {
  const [directorOpen, setDirectorOpen] = React.useState(false)
  const [directorCommand, setDirectorCommand] = React.useState('')
  const [dslConflict, setDslConflict] = React.useState('')
  const [dslGoal, setDslGoal] = React.useState('')
  const [dslConstraint, setDslConstraint] = React.useState('')
  const [dslMedia, setDslMedia] = React.useState('')
  const [dslLocation, setDslLocation] = React.useState('')
  const [dslReveal, setDslReveal] = React.useState('')
  const [controlLevel, setControlLevel] = React.useState<SkillMomentStageControlLevel>('human_guided')
  const [sceneType, setSceneType] = React.useState<SkillMomentStageSceneType>(() => defaultSceneType(roomId))
  const [mediaPolicy, setMediaPolicy] = React.useState<SkillMomentStageMediaPolicy>('allow_one_image_if_author_requests')
  const [conflictTarget, setConflictTarget] = React.useState('')
  const [selectedSlugs, setSelectedSlugs] = React.useState<string[]>([])

  React.useEffect(() => {
    setSceneType(defaultSceneType(roomId))
    setSelectedSlugs([])
  }, [roomId])

  const selectableRoles = React.useMemo(
    () => roles
      .filter((role) => !role.chairman && role.id !== 'skillcreator' && role.id !== 'hafuke')
      .slice(0, 16),
    [roles],
  )

  const toggleRole = React.useCallback((slug: string) => {
    setSelectedSlugs((current) => (
      current.includes(slug)
        ? current.filter((value) => value !== slug)
        : [...current, slug]
    ))
  }, [])

  const directorLines = React.useMemo(() => [
    dslConflict.trim() ? `冲突=${dslConflict.trim()}` : undefined,
    dslGoal.trim() ? `目标=${dslGoal.trim()}` : undefined,
    dslConstraint.trim() ? `限制=${dslConstraint.trim()}` : undefined,
    dslMedia.trim() ? `媒体=${dslMedia.trim()}` : undefined,
    dslLocation.trim() ? `地点=${dslLocation.trim()}` : undefined,
    dslReveal.trim() ? `爆料=${dslReveal.trim()}` : undefined,
    directorCommand.trim(),
  ].filter((line): line is string => Boolean(line)), [
    directorCommand,
    dslConflict,
    dslConstraint,
    dslGoal,
    dslLocation,
    dslMedia,
    dslReveal,
  ])
  const hasDirectorInput = directorLines.length > 0

  const buildStageControl = React.useCallback((): SkillMomentStageControl | undefined => {
    const command = directorLines.join('\n')
    if (!directorOpen || !command) return undefined

    const activeCast = selectedSlugs.length > 0 ? selectedSlugs : undefined
    return {
      schemaVersion: 1,
      stageId: `debt-stage-${Date.now()}`,
      controlLevel,
      sceneType,
      directorCommand: command,
      activeCast,
      speakerOrder: activeCast,
      conflictTarget: conflictTarget.trim() || dslConflict.trim() || undefined,
      mediaPolicy,
      humanGate: 'none',
    }
  }, [conflictTarget, controlLevel, directorLines, directorOpen, dslConflict, mediaPolicy, sceneType, selectedSlugs])

  const handleGenerate = React.useCallback(() => {
    onGenerate(buildStageControl())
  }, [buildStageControl, onGenerate])

  return (
    <div className="border-b border-border/60 bg-background px-6 py-4">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid size-9 place-items-center rounded-[8px] bg-foreground text-background">
            {mode === 'agentos' ? <Settings2 className="size-4" /> : <Radio className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-foreground">
                {mode === 'agentos' ? 'AgentOS' : 'Skill Moments'}
              </h2>
              <span className="rounded-[5px] bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-muted-foreground">
                #{roomLabel}
              </span>
              <span className={cn(
                'rounded-[5px] px-1.5 py-0.5 text-[11px]',
                running ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-foreground/[0.06] text-muted-foreground',
              )}>
                {running ? 'running' : 'manual'}
              </span>
              {directorOpen && hasDirectorInput ? (
                <span className="rounded-[5px] bg-amber-500/12 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                  控场
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{momentCount} moments</span>
              <span>{criticCount} critiques</span>
              {lastRunPath ? <span className="min-w-0 max-w-full truncate">stored: {lastRunPath}</span> : null}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant={directorOpen ? 'default' : 'outline'}
            onClick={() => setDirectorOpen((value) => !value)}
            className="h-8 rounded-[7px]"
          >
            <SlidersHorizontal className="mr-1.5 size-3.5" />
            导演控场
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onReload}
            disabled={loading}
            className="h-8 rounded-[7px]"
          >
            {loading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}
            刷新列表
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleGenerate}
            disabled={running || loading}
            className="h-8 rounded-[7px]"
          >
            {running ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Play className="mr-1.5 size-3.5" />}
            生成一轮
          </Button>
        </div>

        {directorOpen ? (
          <div className="mt-3 border-t border-border/60 pt-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block text-xs font-medium text-muted-foreground">
                冲突
                <input
                  value={dslConflict}
                  onChange={(event) => setDslConflict(event.target.value)}
                  className="mt-1 h-8 w-full rounded-[7px] border border-border/70 bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="祖国人 vs 屠夫"
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                目标
                <input
                  value={dslGoal}
                  onChange={(event) => setDslGoal(event.target.value)}
                  className="mt-1 h-8 w-full rounded-[7px] border border-border/70 bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="逼屠夫公开证据"
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                限制
                <input
                  value={dslConstraint}
                  onChange={(event) => setDslConstraint(event.target.value)}
                  className="mt-1 h-8 w-full rounded-[7px] border border-border/70 bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="雨姐和嘎子只短评"
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                媒体
                <input
                  value={dslMedia}
                  onChange={(event) => setDslMedia(event.target.value)}
                  className="mt-1 h-8 w-full rounded-[7px] border border-border/70 bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="祖国人必须发一张图"
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                地点
                <input
                  value={dslLocation}
                  onChange={(event) => setDslLocation(event.target.value)}
                  className="mt-1 h-8 w-full rounded-[7px] border border-border/70 bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="天台 / 酒馆 / 朝堂"
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                爆料
                <input
                  value={dslReveal}
                  onChange={(event) => setDslReveal(event.target.value)}
                  className="mt-1 h-8 w-full rounded-[7px] border border-border/70 bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="名单 / 证人 / 私密视频"
                />
              </label>
            </div>

            <label className="mt-3 block text-xs font-medium text-muted-foreground" htmlFor="skill-moments-director-command">
              补充导演指令
            </label>
            <textarea
              id="skill-moments-director-command"
              value={directorCommand}
              onChange={(event) => setDirectorCommand(event.target.value)}
              rows={2}
              className="mt-1 max-h-28 min-h-16 w-full resize-y rounded-[7px] border border-border/70 bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/30"
              placeholder="例：祖国人先发主贴，屠夫评论区反打，星光点赞留证。"
            />

            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr]">
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">模式</div>
                <div className="flex flex-wrap gap-1">
                  {controlLevelOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setControlLevel(option.value)}
                      className={cn(
                        'h-7 rounded-[7px] border px-2 text-xs',
                        controlLevel === option.value
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border/70 bg-background text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block text-xs font-medium text-muted-foreground">
                场景
                <select
                  value={sceneType}
                  onChange={(event) => setSceneType(event.target.value as SkillMomentStageSceneType)}
                  className="mt-1 h-8 w-full rounded-[7px] border border-border/70 bg-background px-2 text-sm text-foreground outline-none"
                >
                  {sceneOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-muted-foreground">
                配图
                <select
                  value={mediaPolicy}
                  onChange={(event) => setMediaPolicy(event.target.value as SkillMomentStageMediaPolicy)}
                  className="mt-1 h-8 w-full rounded-[7px] border border-border/70 bg-background px-2 text-sm text-foreground outline-none"
                >
                  {mediaPolicyOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_180px]">
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">演员</div>
                <div className="flex max-h-20 max-w-full flex-wrap gap-1 overflow-y-auto pr-1">
                  {selectableRoles.map((role) => {
                    const slug = roleSlug(role)
                    const selected = selectedSlugs.includes(slug)
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => toggleRole(slug)}
                        className={cn(
                          'inline-flex h-7 max-w-full items-center gap-1 rounded-[7px] border px-2 text-xs',
                          selected
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-border/70 bg-background text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {selected ? <Check className="size-3" /> : null}
                        <span className="truncate">{role.name || role.handle}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <label className="block text-xs font-medium text-muted-foreground">
                冲突对象
                <input
                  value={conflictTarget}
                  onChange={(event) => setConflictTarget(event.target.value)}
                  className="mt-1 h-8 w-full rounded-[7px] border border-border/70 bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="@butcher"
                />
              </label>
            </div>

            <div className="mt-2 text-xs leading-5 text-muted-foreground">
              关闭控场时保持自动运行；打开控场并填写导演指令时，仍由 AgentOS 自动执行，但会按你的指令调整演员、冲突和媒体策略。
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
