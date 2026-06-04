import { describe, it, expect } from 'bun:test'
import type { ElectronAPI } from '../../shared/types'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { buildClientApi } from '../build-api'
import { CHANNEL_MAP } from '../channel-map'

type AnyFn = (...args: any[]) => any

type FunctionKeys<T> = {
  [K in keyof T]-?: Extract<T[K], AnyFn> extends never ? never : K
}[keyof T] & string

type BrowserPaneKeys = `browserPane.${FunctionKeys<ElectronAPI['browserPane']>}`

// Methods excluded from CHANNEL_MAP because they are implemented directly in the preload
// (no IPC round-trip to the main process). Each reads local state or orchestrates client-side.
type ApiToChannelMapKeys = Exclude<
  FunctionKeys<ElectronAPI>,
  | 'performOAuth'
  | 'getTransportConnectionState'
  | 'getRuntimeEnvironment'
  | 'onTransportConnectionStateChanged'
  | 'reconnectTransport'
  | 'isChannelAvailable'
  | 'getSystemWarnings' // reads env var set at startup — no IPC needed
  | 'relaunchApp' // direct IPC to main process — not through WS RPC
  | 'removeWorkspace' // direct IPC to main process — modifies local config
  | 'invokeOnServer' // direct IPC to main process — cross-server RPC
  | 'transferSessionToWorkspace' // direct IPC to main process — orchestrated remote transfer
  | 'onTransferProgress' // direct IPC listener — chunk upload progress
  | 'changeLanguage' // direct IPC to main process — syncs i18n language
  | 'getFilePath' // renderer-local — webUtils.getPathForFile, no IPC round-trip
  | 'getGitRoot' // direct IPC to main process — local git helper
  | 'getGitInfo' // direct IPC to main process — local git helper
  | 'runCodexSkill' // direct IPC to main process — local Codex CLI OAuth skill runner
  | 'recordSkillFeedback' // direct IPC to main process — local Skill Crew feedback sample writer
  | 'refreshSkillCrewSkills' // direct IPC to main process — cache-bypassing Skill Crew filesystem refresh
  | 'importSkillToCrewFolder' // direct IPC to main process — copies installed skills into a Crew room folder
  | 'flowProjectCheckStatus' // direct IPC to main process — local filesystem flow-next bridge
  | 'flowProjectRegister'
  | 'flowProjectUnregister'
  | 'flowReadProjectContext'
  | 'flowInit'
  | 'flowEpicsList'
  | 'flowTasksList'
  | 'flowTaskShow'
  | 'flowTaskUpdateStatus'
  | 'flowEpicCreate'
  | 'flowEpicSetPlan'
  | 'flowEpicDelete'
  | 'flowUiStateRead'
  | 'flowUiStateWrite'
  | 'flowEpicPlan'
  | 'flowEpicPlanApprove'
  | 'flowEpicChatSend'
  | 'flowEpicChatAbort'
  | 'showFlowNotification'
  | 'onFlowChanged'
  | 'onFlowEpicChatStatus'
  | 'onFlowEpicPlanStatus'
  | 'onFlowNotificationNavigate'
> | BrowserPaneKeys
type ChannelMapKeys = keyof typeof CHANNEL_MAP & string

type AssertNever<T extends never> = true

// Compile-time guardrails: if these fail, CHANNEL_MAP and ElectronAPI drifted.
const _missingFromMap: AssertNever<Exclude<ApiToChannelMapKeys, ChannelMapKeys>> = true
const _extraInMap: AssertNever<Exclude<ChannelMapKeys, ApiToChannelMapKeys>> = true

void _missingFromMap
void _extraInMap

describe('CHANNEL_MAP runtime contract', () => {
  it('has valid entry kinds and channels', () => {
    for (const [method, entry] of Object.entries(CHANNEL_MAP)) {
      expect(typeof method).toBe('string')
      expect(entry.type === 'invoke' || entry.type === 'listener').toBe(true)
      expect(typeof entry.channel).toBe('string')
      expect(entry.channel.length).toBeGreaterThan(0)

      if (entry.type === 'listener') {
        expect((entry as any).transform).toBeUndefined()
      }
    }
  })

  it('contains at least one listener and one invoke entry', () => {
    const values = Object.values(CHANNEL_MAP)
    expect(values.some((entry) => entry.type === 'listener')).toBe(true)
    expect(values.some((entry) => entry.type === 'invoke')).toBe(true)
  })

  it('passes Skill Moment stage control through the run-cycle RPC', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const api = buildClientApi({
      invoke: async (channel: string, ...args: unknown[]) => {
        calls.push({ channel, args })
        return { success: true, runId: 'run-1', moments: [], sourceDigests: [], path: '/tmp/skill-moments' }
      },
      on: () => () => {},
    } as any, CHANNEL_MAP)

    const input = {
      workspaceId: 'workspace-1',
      roomId: 'debate',
      runId: 'run-1',
      maxMoments: 2,
      stageControl: {
        schemaVersion: 1 as const,
        stageId: 'stage-1',
        controlLevel: 'human_guided' as const,
        sceneType: 'friend_circle' as const,
        directorCommand: '祖国人和屠夫围绕名单直播吵起来。',
        activeCast: ['homelander', 'butcher'],
        speakerOrder: ['homelander', 'butcher'],
        conflictTarget: '@butcher',
        mediaPolicy: 'allow_one_image_if_author_requests' as const,
        humanGate: 'none' as const,
      },
      skills: [
        { id: 'homelander', name: '祖国人', handle: '@homelander', description: 'Homelander-style skill' },
        { id: 'butcher', name: '屠夫', handle: '@butcher', description: 'Butcher-style skill' },
      ],
    }

    await api.runSkillMomentCycle(input)

    expect(calls).toHaveLength(1)
    expect(calls[0].channel).toBe(RPC_CHANNELS.skillMoments.RUN_CYCLE)
    expect(calls[0].args[0]).toEqual(input)
  })

  it('maps Skill Moment run job audit RPCs', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const api = buildClientApi({
      invoke: async (channel: string, ...args: unknown[]) => {
        calls.push({ channel, args })
        if (channel === RPC_CHANNELS.skillMoments.GET_RUN_JOB) return { job: undefined }
        if (channel === RPC_CHANNELS.skillMoments.WAIT_RUN_JOB) {
          return {
            job: {
              runId: 'run-1',
              workspaceId: 'workspace-1',
              roomId: 'debate',
              state: 'succeeded',
              startedAt: '2026-06-05T00:00:00.000Z',
              eventCount: 3,
              droppedEventCount: 0,
              events: [],
            },
          }
        }
        return { jobs: [] }
      },
      on: () => () => {},
    } as any, CHANNEL_MAP)

    await api.listSkillMomentRunJobs({ workspaceId: 'workspace-1', roomId: 'debate', limit: 3 })
    await api.getSkillMomentRunJob({ workspaceId: 'workspace-1', runId: 'run-1' })
    await api.waitSkillMomentRunJob({ workspaceId: 'workspace-1', runId: 'run-1', timeoutMs: 250 })

    expect(calls).toEqual([
      {
        channel: RPC_CHANNELS.skillMoments.LIST_RUN_JOBS,
        args: [{ workspaceId: 'workspace-1', roomId: 'debate', limit: 3 }],
      },
      {
        channel: RPC_CHANNELS.skillMoments.GET_RUN_JOB,
        args: [{ workspaceId: 'workspace-1', runId: 'run-1' }],
      },
      {
        channel: RPC_CHANNELS.skillMoments.WAIT_RUN_JOB,
        args: [{ workspaceId: 'workspace-1', runId: 'run-1', timeoutMs: 250 }],
      },
    ])
  })
})
