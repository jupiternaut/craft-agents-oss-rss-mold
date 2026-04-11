# RSS Mold Delivery Memo

## What changed

### Product behavior
- `rss-mold` sources now open a custom reader workspace inside Craft Agents instead of the generic source info page.
- The reader workspace shows:
  - grouped article list
  - article detail pane
  - search
  - refresh
  - AI handoff actions: translate, document, card
- The reader uses the same source config shape the MCP source already uses:
  - `RSS_MOLD_CONFIG`
  - `--config`
  - `-c`

### Architecture
- The renderer reads the local feed config file and parses RSS / Atom / JSON Feed in-app.
- A narrow RPC helper fetches raw feed text from `http` and `https` feed URLs.
- The implementation avoids adding a second localhost UI service.
- Existing non-`rss-mold` sources still use the normal `SourceInfoPage`.

## Specs and planning docs
- `artifacts/rss-mold-mvp/research-report.md`
- `artifacts/rss-mold-mvp/PRD.md`
- `artifacts/rss-mold-mvp/PLAN.md`
- `artifacts/rss-mold-mvp/SPEC.md`
- `artifacts/rss-mold-mvp/task.md`

## Interface spec

### Renderer helpers
- `extractRssMoldConfigPath(source)`
- `resolveConfigPath(rawPath, homeDir, sourceFolder)`
- `parseRssMoldConfig(rawConfig)`
- `parseFeedPayload(feed, text)`
- `groupArticlesByDay(articles)`
- `buildArticlePrompt(kind, article)`

### RPC
- `rss:fetchFeedText(url: string) -> string`

Guardrails:
- only `http` and `https`
- request timeout
- payload size limit

## Code map

### Main routing
- `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`

### Reader page
- `apps/electron/src/renderer/pages/RssSourcePage.tsx`
- `apps/electron/src/renderer/pages/index.ts`

### Feed parsing and source helpers
- `apps/electron/src/renderer/lib/rss-mold.ts`

### IPC and protocol wiring
- `apps/electron/src/shared/types.ts`
- `apps/electron/src/transport/channel-map.ts`
- `packages/shared/src/protocol/channels.ts`
- `packages/shared/src/protocol/routing.ts`
- `packages/server-core/src/handlers/rpc/index.ts`
- `packages/server-core/src/handlers/rpc/rss.ts`

### Tests
- `apps/electron/src/renderer/lib/__tests__/rss-mold.test.ts`
- `apps/electron/src/shared/__tests__/ipc-channels.test.ts`

## Verification status
- `packages/shared` typecheck: passed
- `packages/server-core` typecheck: passed
- `apps/electron` typecheck: passed
- `rss-mold.test.ts`: passed
- `ipc-channels.test.ts`: passed

## Current gap
- `To Doc` and `To Card` still open prefilled agent sessions.
- They do not yet write directly into Craft docs/cards.
