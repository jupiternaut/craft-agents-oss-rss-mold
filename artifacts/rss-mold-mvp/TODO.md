# RSS Mold MVP Todo

## Context Summary

### Product direction
- Goal: merge a NetNewsWire-like RSS reading workflow into `craft-agents-oss`, while keeping Craft Agents as the host product.
- Scope: macOS only, incremental changes on top of Craft Agents, avoid deep platform rewrites.
- UX direction: dual-mode product shape.
  - Document / knowledge work should still feel like Craft Agents.
  - Reader workspace should feel as close to NetNewsWire as practical.
- AI role:
  - translate articles
  - extract knowledge
  - eventually save results as both Craft-style documents and cards

### Current implementation status
- `rss-mold` sources are routed to a custom reader page instead of the generic source info page.
- Reader page includes:
  - article list
  - article detail pane
  - search
  - refresh
  - AI handoff actions
- Feed parsing is implemented for:
  - RSS
  - Atom
  - JSON Feed
- Source config discovery is implemented from:
  - `RSS_MOLD_CONFIG`
  - `--config`
  - `-c`
- A narrow RPC helper exists:
  - `rss:fetchFeedText(url)`
- Typecheck and focused tests passed when this slice was built.

### Fork / branch
- Fork repo: `jupiternaut/craft-agents-oss-rss-mold`
- Working branch: `feat/rss-mold-reader-mvp`

## Done

- [x] Researched the host integration strategy
- [x] Wrote PRD / SPEC / PLAN / research notes
- [x] Added `rss-mold` source detection
- [x] Added custom reader page routing
- [x] Built initial reader UI
- [x] Implemented feed config parsing
- [x] Implemented RSS / Atom / JSON Feed normalization
- [x] Added `rss:fetchFeedText` RPC
- [x] Added focused tests for `rss-mold`
- [x] Published the MVP fork and branch to GitHub

## Highest Priority Next

- [ ] Replace prompt-only `To Doc` action with real Craft document creation
- [ ] Replace prompt-only `To Card` action with real Craft card creation
- [ ] Decide the write path for docs/cards inside Craft Agents:
  - existing internal resource/document APIs if available
  - or a minimal new persistence adapter if they do not exist
- [ ] Keep both save targets available from the article pane

## Reader Experience

- [ ] Make the reader workspace visually closer to NetNewsWire
- [ ] Improve article typography, spacing, hierarchy, and list density
- [ ] Add better empty / partial-failure / config-missing states
- [ ] Add keyboard navigation between stories
- [ ] Add feed grouping filters beyond free-text search
- [ ] Improve image handling in article detail
- [ ] Decide whether to keep the current two-pane layout or tighten it further toward a newspaper rhythm

## Source Runtime

- [ ] Install or package a real `rss-mold` MCP runtime on the target machine
- [ ] Verify the local command path for:
  - `mcp serve --module rss-mold`
- [ ] Confirm the final expected source config for real use
- [ ] Run an end-to-end validation where the same source works both:
  - as a readable source page
  - as an MCP source inside agent sessions
- [ ] Decide whether the product should bundle a helper install/setup flow for `rss-mold`

## Product Integration

- [ ] Ensure `rss-mold` appears reliably in Sources without manual navigation quirks
- [ ] Verify deep link behavior for source-specific pages in dev and packaged builds
- [ ] Verify behavior when the user opens multiple windows/workspaces
- [ ] Decide whether `rss-mold` should be a user-created source, a preset source template, or both
- [ ] Decide whether source onboarding should generate `~/craft-rss-mold.json` automatically

## Knowledge Workflow

- [ ] Design the final document schema for article-derived Craft docs
- [ ] Design the final card schema for article-derived Craft cards
- [ ] Decide how translated output, extracted notes, and original source metadata should be linked
- [ ] Preserve source URL, title, feed title, publish time, and author in saved artifacts
- [ ] Decide whether card/document generation should be synchronous in the reader or deferred to background sessions

## Robustness

- [ ] Add tests for malformed feed payloads
- [ ] Add tests for malformed or unexpected config shapes
- [ ] Add tests for partial feed failures across multiple feeds
- [ ] Add tests for source detection edge cases
- [ ] Add tests for date grouping and article selection fallback behavior
- [ ] Validate large feed payload handling and timeout behavior

## Packaging / Release

- [ ] Decide whether this branch should stay as an experiment branch or become a PR against upstream
- [ ] If upstreaming, remove delivery-only artifacts that should not live in the final app repo
- [ ] Write setup docs for developers to reproduce the environment locally
- [ ] Write user-facing setup docs for creating an `rss-mold` source
- [ ] Create screenshots or a short demo for the PR

## Nice-to-Have After MVP

- [ ] In-reader translation preview instead of session-only handoff
- [ ] Read/unread state
- [ ] Smarter article extraction beyond feed content only
- [ ] Feed management UI inside Craft Agents
- [ ] Preset feed bundles
- [ ] Better article-to-note automation

## Open Questions

- [ ] Which internal Craft Agents API is the right target for real document/card creation?
- [ ] Should the app depend on an external `rss-mold` runtime, or should we vendor/package it?
- [ ] How much NetNewsWire UI fidelity is worth pursuing before it starts fighting Craft Agents conventions?
- [ ] Should article actions create resources directly, sessions directly, or both?
