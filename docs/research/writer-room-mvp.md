# Writer Room MVP

Writer Room is an incremental screenplay mode inside the existing Craft Agents Skill Crew system. It reuses the current room model, participants, Skill Moments surface, JSONL storage, workspace skills, renderer state, and main-process IPC instead of introducing a separate ShowrunnerOS app.

## Why Skill Crew

Skill Crew already models a room as a set of local skill participants. That maps directly to a writer room:

- a skill is a craft role or instruction sheet
- an agent is the runtime participant executing that skill
- the current chairman concept is treated conceptually as a showrunner in this mode, without renaming it globally
- a Skill Moment is the visible creative contribution
- a critique is a peer review or continuity note
- a source digest remains the research-context entry point for future work

The MVP keeps the existing Skill Moments cycle as the delivery path because it already persists moments, critiques, source digests, runs, and feedback samples.

## Moment To Artifact Mapping

In this MVP, a Writer Artifact is represented by a normal Skill Moment with a writer artifact tag:

- `writer_artifact:series_bible`
- `writer_artifact:character_bible`
- `writer_artifact:episode_outline`
- `writer_artifact:scene_card`
- `writer_artifact:dialogue_draft`
- `writer_artifact:continuity_report`

The renderer shows these tags as small artifact badges. The stored moment shape is otherwise unchanged.

## Current Artifact Chain

The full Writer Room chain is:

project_brief -> series_bible -> character_bible -> episode_outline -> beat_sheet -> scene_card -> dialogue_draft -> continuity_report -> rewrite_task -> fountain_script

The first mock cycle generates this smaller chain:

series_bible -> character_bible -> episode_outline -> scene_card -> dialogue_draft -> continuity_report

## UI Direction

Writer Room should feel native to Craft Agents. The primary UI source of truth is the existing Skill Crew and Skill Moments surface: current spacing, badges, scroll behavior, card density, buttons, avatar treatment, typography, and theme tokens.

Warp is only a secondary interaction reference for compact agentic workflow surfaces, visible run state, terminal-like density, and clear separation between output, critique, state, and artifact. Writer Room must not copy Warp source code, branding, packages, or visual system.

## Why Mock Only

This PR does not call real LLMs. Deterministic mock generation gives the room model, persistence path, UI badges, and critique behavior a stable acceptance target before source digestion, continuity auditing, or script export are introduced.

## Future AI Route

Future real Writer Room generation must use the existing Codex OAuth / ChatGPT Plus connection path only. The current project already exposes ChatGPT OAuth through the `chatgpt:*OAuth` IPC flow and maps the onboarding method `pi_chatgpt_oauth` to the `chatgpt-plus` connection slug.

Writer Room should not add direct OpenAI API key settings, Anthropic API key settings, Gemini API key settings, local model provider settings, or a new model configuration panel. If Codex OAuth is unavailable in a future real-generation implementation, Writer Room should remain disabled or mock-only instead of falling back to a new provider path.

## Not Implemented

- dedicated `WriterRoomPage`
- real source ingestion
- real LLM writer generation
- structured `writerArtifacts` on stored moments
- Fountain export
- automation-triggered writer room runs
- vector memory
- external framework integration
- local Gemma integration
- OpenSpiel-style conflict simulation
- new model provider settings
- new direct API-key integration

## Next Milestones

1. Add a structured `writerArtifacts` field to persisted Skill Moments.
2. Replace mock phase selection with real skill phase policies.
3. Connect Source Digests to screenplay research context.
4. Add a continuity auditor with structured issue output.
5. Add Fountain export for script drafts.
6. Consider an optional dedicated `WriterRoomPage` after the moments flow is stable.
7. Trigger Writer Room runs from automations.
8. Add real generation through the existing Codex OAuth / ChatGPT Plus route.
