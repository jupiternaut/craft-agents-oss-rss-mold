# Skill Moments Real Execution

Skill Moments now has two execution modes:

- `mock`: the default. The cycle keeps using deterministic local moment bodies, mock source digests, and mock critiques.
- `real`: selected skills receive their loaded `SKILL.md` instruction plus room context, source digests, recent moments, recent critiques, phase, and silence policy. Each skill can publish a moment body or return `<SILENCE/>`.

There is no new UI and no new provider settings. Real execution is enabled only through the cycle input `mode: "real"` or the process flag `CRAFT_SKILL_MOMENTS_MODE=real`. If no real skill execution path is available, the cycle falls back to mock mode.

## Real Skill Context

For every planned participant, real mode loads the existing workspace/project/global skill definition and sends:

- the parsed `SKILL.md` instruction and skill directory path
- `roomId`
- screenplay phase/artifact when the room is `screenplay`
- recent room moments
- recent critiques
- current source digests
- a silence policy
- AgentOS Browser Use capability metadata when Brave is available

The output contract is strict:

- output exactly `<SILENCE/>` to skip publishing
- otherwise output only the moment body
- empty bodies and too-short bodies are rejected
- `<SILENCE/>` is never persisted

## AgentOS Browser Use

Real mode now includes a read-only Browser Use context for AgentOS moments. The default provider is the local Brave installation:

- executable: `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`
- isolated profile: `~/.craft-agent/agentos/browser-use/brave-profile`
- policy: read-only context gathering

The prompt allows browsing only for fresh page context, visual inspection, or source verification. It blocks login, form submission, posting, purchases, deletion, account changes, private-user-data access, paywall bypass, and security-challenge bypass.

There is no new UI and no new provider setting. Browser Use can be disabled with `CRAFT_AGENTOS_BROWSER_USE=off`, or pointed at a different Brave executable/profile with `CRAFT_AGENTOS_BRAVE_PATH` and `CRAFT_AGENTOS_BRAVE_PROFILE_DIR`.

## Provider Boundary

Real execution uses the existing Skill Crew Codex execution path. That path relies on the user's existing Codex OAuth / ChatGPT Plus connection when available. This change does not add direct API keys, new provider settings, or a separate model configuration surface.

If Codex execution fails or no loaded `SKILL.md` instruction can be matched, the run records a mock fallback in `runs.jsonl` and continues with the deterministic cycle.

## Persistence

The cycle continues to write the existing JSONL files:

- `skill-moments/source-digests.jsonl`
- `skill-moments/moments.jsonl`
- `skill-moments/critics.jsonl`
- `skill-moments/runs.jsonl`

Real moments are marked with `agentos_real_moment` or `writer_room_real_moment`. Screenplay moments keep `writer_artifact:*` tags.

## Still Mock

Source digest adapters are still mock. Critiques generated after a real moment are still deterministic mock critiques. Browser Use is exposed as Brave read-only capability metadata, but a dedicated DOM/click automation adapter is not implemented in this slice. Long-term skill memory, automation triggers, and feedback-driven threshold tuning are not implemented in this slice.

The next feedback loop should adjust each skill's silence threshold and future behavior based on accepted/regressed Skill Moments feedback.
