# Storylet x AgentOS Homelander Adaptation

## Source Check

- Downloaded source: `/Users/gengrf/Code/research/storylet`
- Remote: `https://github.com/JungUook/storylet.git`
- Current commit inspected: `6521d74 modify batch files`
- Public repo status: public on GitHub, but README/license badge says private/all rights style. Treat it as readable research code, not reusable commercial code.

This repo is related to the Devpost Storylet project, but it is not the complete Devpost stack. The public repo is mainly a Next.js graph/card editor with GraphRAG and A2A APIs. I did not find Unity runtime code, Yarn Spinner export code, or a separate NestJS backend in the downloaded repo. Devpost describes a fuller target pipeline: web editor, multi-agent generation, Neo4j GraphRAG, Yarn export, Unity playtest.

## What Storylet Actually Gives Us

Useful surfaces in the downloaded repo:

- Graph/card authoring runtime: `src/lib/store.ts`, `src/lib/types.ts`
- Existing graph import/export: `Sidebar.tsx` calls `exportGraph()`, `importGraph()`, and `importGraphAsNewProject()`
- Story templates:
  - `character`
  - `world`
  - `stage`
  - `novel-storyboard`
  - `dialogue-storyboard`
  - ScenarioScope templates such as `ss-character`, `ss-scene`, `ss-chapter`
- GraphRAG sync/search:
  - `/api/graphrag/sync`
  - `/api/graphrag/search`
  - `/api/graphrag/text2cypher`
  - Neo4j nodes: Card, Chunk, Entity, Community
  - edges: connection/reference/mentions/related
- A2A:
  - planner / retriever / writer / verifier agents
  - `/api/a2a/dialogue` streams a character dialogue scene
  - requires `approvalSnapshot.confirmedByUser === true`
  - supports character agents, supervisor agent, narration turns

Key limitation: Storylet does not have our friend-circle runtime. It has a graph editor and a scene-dialogue stream. So the right first adaptation is not "make Storylet become AgentOS"; it is "encode AgentOS friend-circle traces as Storylet cards, then run one controlled scene/dialogue inside Storylet."

## Mapping Our Current Script Into Storylet

Current AgentOS material:

- Main post JSONL: `/Users/gengrf/.craft-agent/workspaces/my-workspace/skill-moments/moments.jsonl`
- Comment JSONL: `/Users/gengrf/.craft-agent/workspaces/my-workspace/skill-moments/critics.jsonl`
- World graph JSONL: `/Users/gengrf/.craft-agent/workspaces/my-workspace/skill-moments/world-graph.jsonl`
- Runtime logic: `/Users/gengrf/craft-agents-oss/apps/electron/src/main/index.ts`

Storylet card mapping:

1. World card
   - Title: `Vought 社交流危机`
   - Core rules:
     - 朋友圈不是聊天窗口，是公开舞台。
     - 祖国人通过镜头、点赞、名单、照片制造权力感。
     - 屠夫通过仅可见朋友圈、证据、证人、账本反击。
     - 其他角色的点赞和短评是阵营信号。

2. Character cards
   - 祖国人: public-image tyrant, wants worship, provokes Butcher, posts images.
   - 屠夫: revenge planner, posts private-only evidence prep, wants public exposure.
   - 碍事丽/Ashley: PR口径统一, keeps Vought members synchronized.
   - 火车头/A-Train: opportunistic amplification, edits tone, avoids risk.
   - 玄色/Black Noir: silent loyalist, likes/screenshots more than speaking.
   - 深海: desperate flatterer.
   - 星光: public witness, likes as evidence, not endorsement.
   - Public/media pressure stays as scene background, not separate character cards.

3. Stage/location cards
   - Vought 塔楼大屏
   - 天台自拍
   - 玻璃天桥
   - 市政厅台阶
   - 屠夫仓库
   - 厂门口/楼道证据点

4. Scene/storylet cards
   - `S01 祖国人天台发图挑衅`: Homelander posts a public image and asks Butcher to turn on location.
   - `S02 屠夫仅小队可见`: Butcher prepares evidence, witness, account book.
   - `S03 Vought 统一点赞`: Ashley, A-Train, Black Noir, Deep amplify in similar tone.
   - `S04 舆论压力发酵`: media pressure and anonymous public attention raise the stakes without adding extra named characters.
   - `S05 评论区对打`: Butcher challenges evidence, Homelander counter-replies.
   - `S06 下一轮钩子`: A concrete reveal is scheduled: name, signature, raw footage, or witness.

5. Connections
   - Homelander hostile-to Butcher
   - Butcher hostile-to Homelander
   - Ashley/A-Train/Black Noir/Deep supports Homelander
   - Starlight observes/contests Homelander
   - Each scene references its participating characters and location

## How To Make Codex Run It Smoothly In Storylet

Smallest practical flow:

1. Generate an importable Storylet graph JSON.
2. Start Storylet locally.
3. Import the JSON from the left sidebar JSON import button.
4. Verify the graph shows character/world/location/scene cards.
5. If Neo4j and keys are available, run GraphRAG sync and search.
6. Run `/api/a2a/dialogue` once with a confirmed approval snapshot:
   - characters: Homelander and Butcher first.
   - optional supervisor: one narrator/supervisor.
   - scene: `S05 评论区对打`.
   - total turns: 6-8.
7. Verify the output is not generic:
   - Homelander must counter Butcher publicly.
   - Butcher must push evidence or revenge plan.
   - At least one narration line must give visible staging.
   - No character should just repeat "我回来了".

The bigger follow-up is to add an exporter from AgentOS JSONL into Storylet graph JSON, but the first run should be manual/seeded so the pipeline can be judged visually.

## Prompt For A Fresh Codex

Use this prompt when a new Codex session has no context:

```text
You are working on my macOS machine. Goal: run the AgentOS Homelander friend-circle drama inside the downloaded Storylet project as a small, controlled Storylet graph and one dialogue scene.

Important paths:
- Storylet source: /Users/gengrf/Code/research/storylet
- AgentOS/Craft repo: /Users/gengrf/craft-agents-oss
- AgentOS Skill Moments data:
  - /Users/gengrf/.craft-agent/workspaces/my-workspace/skill-moments/moments.jsonl
  - /Users/gengrf/.craft-agent/workspaces/my-workspace/skill-moments/critics.jsonl
  - /Users/gengrf/.craft-agent/workspaces/my-workspace/skill-moments/world-graph.jsonl

First verify Storylet source:
- If /Users/gengrf/Code/research/storylet does not exist, clone https://github.com/JungUook/storylet.git there.
- Inspect README.md, src/lib/types.ts, src/lib/store.ts, src/lib/data/templates/story-maker.json, src/lib/data/templates/scenarioscope.json, src/app/api/a2a/dialogue/route.ts, and src/app/api/graphrag/sync/route.ts.
- Do not assume the Devpost Unity/Yarn runtime exists in this public repo unless you find it in source.

Constraints:
- Do not touch or revert dirty files in /Users/gengrf/craft-agents-oss.
- Do not commit API keys.
- Do not add provider settings.
- If Gemini/OpenAI/Neo4j keys are missing, still create the graph JSON and run the UI import path; skip real LLM/GraphRAG with a clear note.
- Keep changes inside /Users/gengrf/Code/research/storylet or a small artifact directory under /Users/gengrf/Code/research.

Task:
1. Create an importable Storylet graph JSON artifact named /Users/gengrf/Code/research/agentos-homelander-storylet.graph.json.
2. The graph must contain:
   - one world card: "Vought 社交流危机"
   - character cards: 祖国人, 屠夫, 碍事丽, 火车头, 玄色, 深海, 星光
   - location cards: Vought 塔楼大屏, 天台自拍, 玻璃天桥, 市政厅台阶, 屠夫仓库, 厂门口/楼道证据点
   - scene cards:
     S01 祖国人天台发图挑衅
     S02 屠夫仅小队可见
     S03 Vought 统一点赞
     S04 舆论压力发酵
     S05 评论区对打
     S06 下一轮钩子
   - hostile/support/observes/amplifies connections between the cards.
3. Use Storylet's actual Graph/Card schema from src/lib/types.ts and existing template field keys from story-maker.json. Do not invent a different schema.
4. Start Storylet:
   - npm install if node_modules is missing
   - cp env.local.template .env.local if missing
   - npm run dev
5. Open http://localhost:3000 and import the generated graph using the existing JSON import button in the sidebar.
6. Verify visually or through app state that the graph loaded and cards are present.
7. If API keys and app routes allow it, run one A2A dialogue scene through /api/a2a/dialogue with approvalSnapshot.confirmedByUser=true:
   - scene: S05 评论区对打
   - characters: 祖国人 and 屠夫, optionally 星光 as witness
   - scheduler: round_robin
   - totalMaxTurns: 6
   - requirement: Homelander must publicly counter Butcher; Butcher must force evidence/signature/witness stakes.
8. Save the resulting transcript to /Users/gengrf/Code/research/agentos-homelander-storylet-transcript.md.

Acceptance:
- The graph imports into Storylet.
- Cards are visible and named in Chinese.
- The scene is legible as a staged social-feed conflict, not generic fantasy dialogue.
- The final report says exactly what was verified, what failed, and whether Unity/Yarn export exists in the public repo.
```
