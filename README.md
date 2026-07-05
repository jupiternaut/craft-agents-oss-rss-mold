# Craft Agents OSS RSS Mold Base

Upstream Craft Agents OSS fork used as the base boundary for RSS Mold work.

This repository is a fork of `craft-ai-agents/craft-agents-oss`. It should be read as the upstream/base checkout for RSS Mold handoff work, not as the repository that contains the RSS implementation. The RSS Mold delivery bundle lives in [`jupiternaut/rss-mold-craft-agents-delivery`](https://github.com/jupiternaut/rss-mold-craft-agents-delivery).

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [Repository Layout](#repository-layout)
- [Status](#status)
- [Maintainer](#maintainer)
- [Contributing](#contributing)
- [License and Upstream](#license-and-upstream)

## Background

The source tree is still the Craft Agents OSS monorepo:

- Electron desktop app and bundled resources.
- Web UI and viewer apps.
- Server, server-core, session tools, shared packages, and Pi agent server packages.
- CLI client and validation scripts.

The repository name includes `rss-mold`, but this checkout does not expose an RSS reader app or RSS-specific source directory. Use it to inspect or patch the Craft Agents OSS base. Use `rss-mold-craft-agents-delivery` for the actual RSS Mold integration/delivery boundary.

## Install

Requirements:

- Bun
- Node-compatible package tooling
- Electron dependencies when working on the desktop app

Clone this fork:

```sh
git clone https://github.com/jupiternaut/craft-agents-oss-rss-mold.git
cd craft-agents-oss-rss-mold
bun install
```

## Usage

Run the inherited Craft Agents desktop path:

```sh
bun run electron:start
```

Run server or validation paths:

```sh
bun run server:start
bun run typecheck
bun run validate:dev
```

RSS Mold handoff readers should also inspect:

```text
https://github.com/jupiternaut/rss-mold-craft-agents-delivery
```

That linked repository is the delivery bundle for the RSS Mold reader integration.

## Repository Layout

- `apps/electron/` - Craft Agents Electron desktop app, resources, scripts, and renderer/main code.
- `apps/webui/` - web UI app.
- `apps/viewer/` - viewer app.
- `apps/cli/` - WebSocket CLI client.
- `packages/core/` - shared type and utility package.
- `packages/server-core/` - headless server domain, transport, runtime, and web UI support.
- `packages/server/` - server entry point package.
- `packages/pi-agent-server/` - Pi/agent server package, including search provider logic.
- `packages/session-*` - session MCP server and session tools packages.
- `packages/shared/` - shared agent, config, model, browser, and UI support code.
- `docs/` - inherited docs such as CLI notes.
- `scripts/` - build, release, validation, and desktop helper scripts.

## Status

Upstream base fork. No RSS implementation boundary was found in this checkout. The expected split is:

- This repo: Craft Agents OSS base, compatibility, and patch context.
- `rss-mold-craft-agents-delivery`: RSS Mold delivery and reader integration boundary.

## Maintainer

Maintained in the `jupiternaut/craft-agents-oss-rss-mold` fork.

## Contributing

Keep contributions explicit about which boundary they affect:

- Craft Agents base changes belong here.
- RSS Mold reader implementation and delivery material should go to `rss-mold-craft-agents-delivery`.
- Do not imply RSS functionality exists in this checkout unless source files are added here.

Before pushing broad base changes, run the smallest relevant typecheck or validation command.

## License and Upstream

Licensed under Apache-2.0. See [LICENSE](LICENSE).

Upstream: [`craft-ai-agents/craft-agents-oss`](https://github.com/craft-ai-agents/craft-agents-oss).

Local fork: [`jupiternaut/craft-agents-oss-rss-mold`](https://github.com/jupiternaut/craft-agents-oss-rss-mold).
