# Staged Theater Control Loop

This is the staged path for making Skill Crew feel alive without handing the whole room to the model too early.

The product goal is still an automatic stage play: multiple skills have goals, relationships, memory, conflict, and media behavior. The near-term goal is narrower: run the SillyTavern chain and the Chongzhen-simulator-style chain under human stage control, then gradually relax control after the outputs stay coherent.

## Current Local Evidence

SillyTavern is already present locally:

- App: `/Users/gengrf/SillyTavern`
- Codex proxy: `/Users/gengrf/sillytavern-codex-proxy`
- Start script: `/Users/gengrf/start-sillytavern-codex.sh`
- Existing world book: `/Users/gengrf/SillyTavern/data/default-user/worlds/两个世界.json`
- Existing director chat: `/Users/gengrf/SillyTavern/data/default-user/chats/TwoWorlds_Director/`
- Existing local proxy model endpoint: `http://127.0.0.1:8787/v1`
- Existing SillyTavern app endpoint: `http://127.0.0.1:8000/`

The local SillyTavern Codex proxy is text-only and uses the Codex app-server / local Codex login path. It should be treated as a controlled text-runtime comparison target, not as the image/media worker.

The Chongzhen simulator is not present as local source code in this workspace. Its public Steam page describes a natural-language edict loop with LLM-generated world-state feedback and dynamic minister dialogue. Treat it as a pattern to reproduce locally:

`edict -> world model update -> minister reactions -> state ledger -> next edict`

Do not depend on the Steam game as an integration target until there is a stable local API or export path.

## Stage Gates

### Gate 1: Human-Locked

The human director controls:

- active scene premise
- active cast
- speaker order
- conflict target
- allowed secrets
- whether a generated post/comment is accepted
- whether media generation is allowed

The model may only fill actor utterances inside the directed frame.

Expected output:

- short, visible scene beats
- uneven comment lengths
- role-specific speech patterns
- no generic filler
- no automatic long-term behavior changes

### Gate 2: Human-Guided

The system may propose:

- next speaker
- escalation target
- image prompt
- private/public visibility
- memory update candidates

The human still accepts or rejects the stage plan before persistence.

Expected output:

- controlled conflict arcs
- visible actor motivation
- memory candidates that can be inspected
- repeatable replay from JSONL

### Gate 3: Free Actor Runtime

Only after the first two gates are stable:

- skills choose when to speak
- skills adjust their own silence threshold
- actors initiate posts
- media behavior can be scheduled
- memory retrieval affects next utterance automatically

Expected output:

- autonomous stage play
- skills with persistent goals and grudges
- audience-facing feed that feels alive without manual prompting

## SillyTavern Chain

Use SillyTavern as the reference implementation for static roleplay assets:

1. Character card / persona defines voice and surface behavior.
2. World book injects setting and constraints.
3. Chat history creates local continuity.
4. Group chat / director prompt controls speaker shape.
5. Codex proxy supplies the model through the existing local Codex login path.

AgentOS should not copy this directly. AgentOS should import the useful parts into a runtime:

1. Character card becomes skill instruction.
2. World book becomes source digest plus room canon.
3. Chat history becomes recent moments and memory candidates.
4. Group chat becomes actor scheduling.
5. Director prompt becomes stage-control contract.

Manual acceptance rule:

No SillyTavern output becomes AgentOS memory or a Skill Moment until a human accepts the beat.

## Chongzhen-Style Chain

Use the Chongzhen simulator as the reference implementation for stateful command-and-council play:

1. Human issues an edict.
2. World state changes.
3. Ministers react from positions and interests.
4. The state ledger records consequences.
5. The next round starts from the changed court.

AgentOS equivalent:

1. Human director issues a stage command.
2. Room state changes.
3. Skills react from goals, relationships, and memory.
4. Actor state JSONL records accepted changes.
5. The next feed cycle retrieves that state before speaking.

Manual acceptance rule:

The world-state update is draft-only until the human accepts the cycle.

## Proposed AgentOS Runtime Contract

Every controlled stage cycle should have this shape:

```json
{
  "schemaVersion": 1,
  "stageId": "debate-homelander-001",
  "controlLevel": "human_locked",
  "sceneType": "friend_circle" ,
  "directorCommand": "祖国人发一条特朗普式挑衅朋友圈，屠夫必须挑衅回应，阿什莉控评，其他人随机点赞或沉默。",
  "activeCast": ["homelander", "butcher", "ashley", "atrain", "black-noir"],
  "conflictTarget": "homelander_vs_butcher",
  "mediaPolicy": "allow_one_image_if_author_requests",
  "humanGate": "before_persist"
}
```

Actor output contract:

```json
{
  "speaker": "butcher",
  "action": "comment",
  "visibility": "public",
  "body": "你敢放名单，我就敢把第一个名字念出来。猜猜是谁签的字？",
  "reactions": [{"kind": "like", "by": "starlight"}],
  "memoryCandidates": [
    {
      "kind": "grudge",
      "summary": "Butcher escalated against Homelander over the Vought list threat.",
      "confidence": "medium"
    }
  ],
  "mediaRequest": null
}
```

Persistence targets:

- `stage-runs.jsonl`: director command, cast, control level, accepted/rejected status
- `moments.jsonl`: accepted posts
- `critics.jsonl`: accepted comments
- `actor-states.jsonl`: accepted state deltas only
- `actor-memory.jsonl`: accepted actor memory only; when `humanGate !== "none"`, real-skill memory candidates stay in `runs.jsonl.draftActorMemory` / `stage-runs.jsonl.draftActorMemory` and are not retrievable next round
- `source-digests.jsonl`: SillyTavern / public-source / media provenance
- `world-graph.jsonl`: run graph/audit snapshot, including explicit `stayed_silent` edges for real `<SILENCE/>` decisions and for mock eligible actors that produced no post or comment; snapshots with `acceptedMemoryApplied: false` are not used as next-round world-graph memory

Lightweight show evaluation now belongs in the run records, not in a new UI:

- `runs.jsonl.showScore` / `runs.jsonl.showEvaluation`
- `stage-runs.jsonl.showScore` / `stage-runs.jsonl.showEvaluation`
- `complete` / `persisting` run status events carry the same `showScore` and `showEvaluation` payload for UI display
- metrics: repetition, conflict strength, visuality, actor participation, media missing risk
- actor continuity: world graph memory should say who replied to whom, who liked whom, and who stayed silent
- scheduler notes should explain cast choice from director instruction, historical conflict, historical comments, historical likes, and media requirements

Human gate memory rule:

- `acceptedMemoryApplied` is `true` only when `humanGate === "none"`.
- With `humanGate: "before_persist"` or any other gated value, real actor `state_updates` are stored as draft audit fields (`draftActorStates`, `draftActorMemory`) on the run records, but are not appended to `actor-states.jsonl` or `actor-memory.jsonl`.
- Gated world-graph snapshots remain auditable, but historical world-graph retrieval skips snapshots whose `acceptedMemoryApplied` is `false`.
- Ungated/default non-stage runs preserve the existing immediate actor-memory behavior.

## First Implementation Slice

Use the current Skill Moments surface. Do not build a new page.

1. Add a stage-control input object behind the run-cycle call.
2. Keep default mode as current behavior.
3. Add `controlLevel: "human_locked"` for the first version.
4. Let the director command bias:
   - selected skills
   - speaker order
   - public/private visibility
   - max comments
   - media permission
5. Produce draft state deltas but do not apply them automatically unless `humanGate === "none"`.
6. Show the cycle in the existing AgentOS status sidebar.

This turns "刷新/生成一轮" into a directed rehearsal when a stage command exists, while preserving the current manual Skill Moments flow.

## Acceptance Criteria

SillyTavern chain:

- `http://127.0.0.1:8000/` opens.
- `http://127.0.0.1:8787/v1/models` returns `codex-default`.
- The existing `TwoWorlds_Director` chat and `两个世界` world book can be inspected.
- A human can copy one accepted beat into AgentOS as a source digest or director command.

Chongzhen-style chain:

- A human stage command creates one controlled cycle.
- At least three actors respond according to position, not generic politeness.
- The state ledger records draft consequences separately from accepted memory.
- The next cycle can read accepted state.

Skill Moments chain:

- Comment counts vary.
- Comment lengths vary.
- Likes are stored as reactions, not fake comment text.
- Browser/media generation is observable through the browser worker.
- Actor state is only applied after acceptance in `human_locked` mode.

## Next PR

Implement `stage-control` on top of the current run-cycle:

- new shared type for `SkillMomentStageControl`
- optional `stageControl` in `SkillMomentRunCycleInput`
- stage-control persistence in `stage-runs.jsonl`
- human-locked draft actor state output
- tests for directed speaker order, draft memory not auto-applied, and variable comment counts

After that PR, wire SillyTavern import/export as a sidecar:

- read SillyTavern character/world/chat files
- convert accepted beats into source digests
- never mutate SillyTavern files unless explicitly requested

## Imported Reference Techniques

The current debt implementation has started importing the strongest narrow techniques from adjacent projects without adopting their full stack.

Storylet-style director DSL:

- A freeform director command can now include structured lines such as `冲突=祖国人 vs 屠夫`, `目标=逼屠夫公开证据`, `限制=雨姐只短评`, `媒体=祖国人必须发图`.
- The run cycle parses those lines into a `stagePlan`.
- The plan is written into `source-digests.jsonl`, `stage-runs.jsonl`, and `runs.jsonl`.
- Real skills receive the plan through source digests; mock mode also uses it to bias bodies.

AI Town / Generative Agents-style world state foundation:

- Each run now writes a `world-graph.jsonl` snapshot.
- The snapshot contains nodes for run, room, stage, actors, moments, critiques, media, and source digests.
- It records edges such as `casts`, `directs`, `conflicts_with`, `publishes`, `critiques`, `likes`, `requests_media`, and `triggers`.
- This is still a persisted graph snapshot, not yet a live world tick loop or vector retrieval system.

CleanGetaway-style shared state basis:

- Likes are represented as graph edges rather than only rendered UI details.
- Comments and critiques become graph nodes/edges, so later spectator feedback can be folded into the next run.
- This gives us a future multiplayer/shared-view state layer without introducing Socket.IO or a new realtime server yet.

Current limitation:

- `world-graph.jsonl` is written but not yet retrieved before actor decisions.
- Director DSL is parsed heuristically, not with a schema editor.
- There is no continuous tick loop yet; the run remains a user-triggered async job.
