import type {
  SkillMomentActorIntentCard,
  SkillMomentDemoContract,
  SkillMomentShowFeedbackCalibration,
  SkillMomentSkillInput,
  SkillMomentStageControl,
} from '../../shared/types'
import { normalizeSkillMomentSlug } from './room-policies'

export type SkillMomentStagePlanLike = {
  sceneType?: SkillMomentStageControl['sceneType']
  conflict?: {
    left: string
    right: string
  }
  goal?: string
  constraints?: string[]
  mediaInstruction?: string
  reveal?: string
  inferredActorSlugs?: string[]
}

export type SkillMomentDramaScheduleLike = {
  prioritizedActorSlugs: string[]
  requiredBeats?: string[]
  antiRepeatRules?: string[]
  feedbackInfluence?: string
  notes: string[]
}

function compactIntentText(value: string | undefined, fallback: string): string {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  if (!trimmed) return fallback
  return trimmed.length > 86 ? `${trimmed.slice(0, 84)}...` : trimmed
}

function describeFeedbackInfluence(feedback?: SkillMomentShowFeedbackCalibration): string | undefined {
  if (!feedback || feedback.counts.total === 0) {
    return undefined
  }
  if (feedback.adjustment < -0.01) {
    return '观众反馈偏退化：下一轮强制减少复读和套话，优先安排反击、爆料、短评论。'
  }
  if (feedback.adjustment > 0.01) {
    return '观众反馈偏进化：下一轮继续强化冲突、画面和有效站队。'
  }
  return '观众反馈分歧不大：维持当前冲突节奏，但每条内容仍必须推进局势。'
}

function defaultConflict(roomId: string): { left: string; right: string } {
  if (roomId === 'debate') {
    return { left: '祖国人', right: '屠夫' }
  }
  return { left: '主角', right: '对手' }
}

function defaultRequiredBeats(args: {
  roomId: string
  stagePlan?: SkillMomentStagePlanLike
  mediaEnabled: boolean
}): string[] {
  const beats = [
    '主角必须公开挑衅或抛出要求',
    '死敌必须反击、埋雷或转入仅可见行动',
    '至少一名盟友控评或站队',
    '至少一名旁观者质疑、拱火或给出证据线索',
  ]
  if (args.stagePlan?.reveal) {
    beats.push('爆料必须改变下一轮目标')
  }
  if (args.mediaEnabled || args.stagePlan?.mediaInstruction) {
    beats.push('本轮至少准备一条有画面感的图片动作')
  }
  return beats
}

export function buildSkillMomentDemoContract(args: {
  roomId: string
  stageControl?: SkillMomentStageControl
  stagePlan?: SkillMomentStagePlanLike
  dramaSchedule: SkillMomentDramaScheduleLike
  feedbackCalibration?: SkillMomentShowFeedbackCalibration
  mediaEnabled?: boolean
}): SkillMomentDemoContract {
  const conflict = args.stagePlan?.conflict ?? defaultConflict(args.roomId)
  const mediaEnabled = Boolean(args.mediaEnabled || args.stageControl?.mediaPolicy === 'allow_actor_requested_images' || args.stagePlan?.mediaInstruction)
  const feedbackInfluence = args.dramaSchedule.feedbackInfluence ?? describeFeedbackInfluence(args.feedbackCalibration)

  return {
    schemaVersion: 1,
    title: 'AI 角色朋友圈剧场',
    scene: args.stageControl?.sceneType ?? args.stagePlan?.sceneType ?? 'friend_circle',
    conflict: {
      left: conflict.left,
      right: conflict.right,
      publicLabel: `${conflict.left} vs ${conflict.right}`,
    },
    goal: compactIntentText(args.stagePlan?.goal, '让冲突在两分钟内升级，让观众看懂谁在挑衅、谁在反击、谁在站队。'),
    requiredBeats: args.dramaSchedule.requiredBeats?.length
      ? args.dramaSchedule.requiredBeats
      : defaultRequiredBeats({
        roomId: args.roomId,
        stagePlan: args.stagePlan,
        mediaEnabled,
      }),
    antiRepeatRules: args.dramaSchedule.antiRepeatRules?.length
      ? args.dramaSchedule.antiRepeatRules
      : [
        '禁止重复“我回来了/我复活了”式宣言',
        '禁止只有“已点赞/欢迎回来/Big moment”的低价值评论',
        '每条主贴或评论必须带来新动作、新证据、新站队或新画面',
      ],
    feedbackInfluence,
    originalShell: args.roomId === 'debate'
      ? {
        protagonist: '天塔英雄',
        antagonist: '猎犬',
        world: '超英公关危机朋友圈',
      }
      : undefined,
  }
}

function skillLabel(skill: SkillMomentSkillInput): string {
  return skill.name?.trim() || skill.handle?.replace(/^@/, '') || skill.id
}

function targetForSlug(slug: string, conflict?: { left: string; right: string }): string | undefined {
  if (!conflict) return undefined
  if (slug === 'homelander') return conflict.right
  if (slug === 'butcher') return conflict.left
  return conflict.left || conflict.right
}

function intentTemplate(args: {
  slug: string
  conflict?: { left: string; right: string }
  directorGoal: string
  mediaEnabled: boolean
  wasPrioritized: boolean
  feedbackInfluence?: string
}): Omit<SkillMomentActorIntentCard, 'schemaVersion' | 'skillId' | 'skillName' | 'handle' | 'slug'> {
  const target = targetForSlug(args.slug, args.conflict)
  const priorityMemory = args.wasPrioritized ? '本轮被调度器点名，需要主动推进局势。' : '观察上一轮关系和观众反馈，避免无意义跟帖。'
  switch (args.slug) {
    case 'homelander':
      return {
        role: '公开挑衅者',
        goal: '把危机改造成忠诚测试，逼对手在公开场合接招。',
        memory: compactIntentText(args.feedbackInfluence, '记得屠夫上轮要求证据，不能再只宣布自己回来了。'),
        nextAction: args.mediaEnabled ? '发带地点或自拍的主贴，点名对手并要求他交出证据。' : '公开点名对手，把城市和镜头都变成施压工具。',
        target,
        visibility: 'public',
        mediaIntent: args.mediaEnabled,
        risk: '容易复读宣言，必须带新动作。',
      }
    case 'butcher':
      return {
        role: '复仇反击者',
        goal: '让对方把话说满，再用证据或威胁反打。',
        memory: '记得公开羞辱和名单威胁，优先准备报复线索。',
        nextAction: '先嘴炮反击；必要时发仅可见朋友圈，写清楚下一步找谁、查哪条证据。',
        target,
        visibility: 'private',
        risk: '如果只骂人不埋雷，冲突会停在表面。',
      }
    case 'ashley':
      return {
        role: '危机公关',
        goal: '统一口径，替强势角色控评但暴露紧张感。',
        memory: priorityMemory,
        nextAction: '短句发布官方话术，要求账号统一转发，不要自由发挥。',
        target,
        visibility: 'comment',
      }
    case 'atrain':
      return {
        role: '顺风站队者',
        goal: '快速跟队，但留下一点怕事和自保。',
        memory: priorityMemory,
        nextAction: '用很短的附和或转发语气站队，避免长篇解释。',
        target,
        visibility: 'comment',
      }
    case 'black-noir':
      return {
        role: '沉默执行者',
        goal: '用点赞或极短反应制造压迫感。',
        memory: priorityMemory,
        nextAction: '只做点赞或一句极短确认，让沉默也像行动。',
        target,
        visibility: 'like',
      }
    case 'deep':
      return {
        role: '笨拙附和者',
        goal: '努力表忠心，但说出口会显得尴尬。',
        memory: priorityMemory,
        nextAction: '发一条短促、略跑偏的附和，给场面增加喜剧尴尬。',
        target,
        visibility: 'comment',
      }
    case 'starlight':
      return {
        role: '内部异议者',
        goal: '不正面认同，把点赞或评论变成留证。',
        memory: '记得公开发言会被截图，所以要用克制的反讽留下线索。',
        nextAction: '短评质疑或留证，不跟官方口径走。',
        target,
        visibility: 'comment',
      }
    case 'gazi':
      return {
        role: '直播叫卖式拱火者',
        goal: '把严肃冲突讲成直播间热闹，顺手卖人情。',
        memory: priorityMemory,
        nextAction: '用短促口播式评论拱火，不要像机器人点赞。',
        target,
        visibility: 'comment',
      }
    case 'dongbei-yujie':
      return {
        role: '东北生活流围观者',
        goal: '用热乎、直接的生活口吻把场面拽回人间。',
        memory: priorityMemory,
        nextAction: '短评劝、呛或围观，句子长短自然变化。',
        target,
        visibility: 'comment',
      }
    case 'liu-haizhu':
      return {
        role: '江湖狠话执行者',
        goal: '把嘴炮变成要动手的现场感。',
        memory: priorityMemory,
        nextAction: '发带地点和动作的朋友圈或评论，像真的要去现场。',
        target,
        visibility: 'public',
        mediaIntent: args.mediaEnabled,
      }
    default:
      return {
        role: '围观变量',
        goal: compactIntentText(args.directorGoal, '根据角色人设选择站队、质疑、沉默或拱火。'),
        memory: priorityMemory,
        nextAction: '只在能推动冲突时发言，否则沉默。',
        target,
        visibility: args.wasPrioritized ? 'comment' : 'silent',
      }
  }
}

export function buildSkillMomentActorIntentCards(args: {
  skills: SkillMomentSkillInput[]
  stagePlan?: SkillMomentStagePlanLike
  dramaSchedule: SkillMomentDramaScheduleLike
  demoContract: SkillMomentDemoContract
  feedbackCalibration?: SkillMomentShowFeedbackCalibration
  mediaEnabled?: boolean
}): SkillMomentActorIntentCard[] {
  const priority = new Map(args.dramaSchedule.prioritizedActorSlugs.map((slug, index) => [slug, index]))
  const skills = [...args.skills].sort((left, right) => {
    const leftPriority = priority.get(normalizeSkillMomentSlug(left)) ?? Number.MAX_SAFE_INTEGER
    const rightPriority = priority.get(normalizeSkillMomentSlug(right)) ?? Number.MAX_SAFE_INTEGER
    if (leftPriority !== rightPriority) return leftPriority - rightPriority
    return skillLabel(left).localeCompare(skillLabel(right))
  })
  const feedbackInfluence = args.dramaSchedule.feedbackInfluence ?? describeFeedbackInfluence(args.feedbackCalibration)

  return skills.map((skill) => {
    const slug = normalizeSkillMomentSlug(skill)
    const template = intentTemplate({
      slug,
      conflict: args.demoContract.conflict,
      directorGoal: args.demoContract.goal,
      mediaEnabled: Boolean(args.mediaEnabled || args.stagePlan?.mediaInstruction),
      wasPrioritized: priority.has(slug),
      feedbackInfluence,
    })
    return {
      schemaVersion: 1,
      skillId: skill.id,
      skillName: skill.name,
      handle: skill.handle,
      slug,
      ...template,
    }
  })
}
