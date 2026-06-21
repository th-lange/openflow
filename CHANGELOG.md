# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(pre-1.0: minor/patch bumps may include behavioural changes — see the BETA notice in the README).

## [Unreleased]

## [0.2.11] - 2026-06-21

### Added
- **Structured handoffs** (#64) — sequential workflows now thread a compact ` ```handoff ` block (decided / files / next) between steps instead of the full transcript, and the relay shows intermediate steps as their handoff with the final step in full. Downstream agents re-read named files via their own tools. The built-in pipeline agents (`composer`, `coder`, `coder-strong`, `coder-weak`, `analyzer`) emit handoff blocks.
- **`contextScope` for sequential workflows** (#63) — control how much prior-step output is threaded into each step: `all` (default), `last` (previous step only), or `none`. Cuts the O(n²) token growth on long sequences. Settable in `openflow.json` and via `create_workflow`; validated at load time.

### Changed
- **Compact context is now the default** for sequential workflows (#64): intermediate-step context and relay are threaded as handoff blocks rather than full outputs. This reduces token cost but changes what downstream steps see — set `compactContext: false` per workflow to restore the previous full-output behaviour.

## [0.2.10] - 2026-06-21

### Added
- **Token/cost accounting** (#62) — every agent delegation now captures its token usage (input/output/reasoning, cache read/write) and cost from the OpenCode response. A workflow run aggregates these across all steps (including nested patterns) and appends a compact footer to the relay, e.g. `tokens: 12.3k in / 4.1k out · cache 82% read · ~$0.04 · 5 steps`. `delegate_task` shows a single-step footer. Foundational for the token-efficiency epic (#61).
- **Interactive workflow builder** — `/build-workflow` activates a new primary `workflow-builder` agent that interviews the user element by element and writes a validated **sequential, commander-supervised** workflow to `openflow.json` (create and modify flows).
- `list_agents` tool — read-only listing of available agents (optional `mode` filter), used by the builder to offer valid choices.
- `locked: true` flag on workflow entries — locked workflows cannot be overwritten (even with `force`), enabled, or disabled by the management tools; marked `[locked]` in `list_workflows`.

### Changed
- Reserved the `workflow-builder` agent name so `create_agent` cannot clobber the built-in builder.

## [0.2.9] - 2026-06-18

### Added
- Optional top-level `settings` block in `openflow.json` to tune the execution engine:
  - `agentTimeoutMs` — per-agent delegation timeout (default `300000`).
  - `maxConcurrent` — max agents dispatched at once in `fanout`/`parallel` (default `5`).
- Environment overrides `OPENFLOW_AGENT_TIMEOUT_MS` and `OPENFLOW_MAX_CONCURRENT`, which take precedence over the file.
- Execution-path unit tests with an in-memory `OpencodeClient` double — covering `delegate-task`, `parallel-dispatch`, and every runner (sequential, evaluator-optimizer, fanout, parallel, debate, conditional) plus settings parsing. Suite now 136 tests, no LLM required.

### Changed
- `settings` are validated at startup; invalid values (non-positive timeout, non-integer concurrency) fail fast instead of being silently ignored.
- README documents the `settings` block and env overrides.

### Fixed
- `delegateTask` never cleared its timeout timer or abort listener after a successful delegation, leaving a 5-minute timer holding the event loop open. The timer and listener are now torn down once the race settles.

## [0.2.8] - 2026-06-18

### Removed
- Legacy MCP entrypoint (`src/mcp.ts`). The native OpenCode plugin is now the sole entrypoint.

### Changed
- README rewritten for the plugin architecture.

## [0.2.7] - 2026-06-18

### Added
- Native OpenCode plugin port (ADR 0001): the plugin host injects a connected `client` and the correct `directory`, so the deterministic engine spawns child sessions directly. Restores `run_workflow` with real concurrency, enforced iteration/round limits, structured outputs, and `AbortSignal` cancellation.
- Startup validation of `openflow.json` (unknown agents, dangling workflow references, cycles) reported in the OpenCode logs.
- `create_workflow` supports all seven patterns with off-disk validation and rollback.
- Single source of truth for agent prompts via a generator (`scripts/build-agents.mjs`).
- CI workflow: typecheck → test → build → committed-`dist/` drift guard.
- MIT `LICENSE` and ADR 0001 (execution-model decision).
- Comment-preserving JSONC config writes; `create_agent` resolves `opencode.jsonc`.

### Changed
- Consolidated workflow parsers so the runtime lookup and the startup validator share one code path.
- Packaging: ship `src/` for the tsx fallback; keywords/author metadata.

### Fixed
- Portable single-level glob in the test script (CI globstar mismatch).

## [0.2.6] and earlier - 2026-06-17

Initial beta line. Highlights:
- `delegate_task` tool, config loaders, step store, and the original MCP server.
- Commander agent plus built-in subagents (composer, coder, analyzer, and the routing/quality agents).
- Workflow patterns: sequential, orchestrator, evaluator-optimizer, conditional, fanout, parallel, debate, human checkpoint, and pattern composition (workflow references as steps).
- `create_workflow` / `create_agent` / `enable_workflow` / `disable_workflow` management tools.
- `openflow` install CLI that configures `opencode.json`/`.jsonc` (global or per-project).
- README, sample `openflow.json`, and E2E test suite.

[Unreleased]: https://github.com/th-lange/openflow/compare/v0.2.9...HEAD
[0.2.9]: https://github.com/th-lange/openflow/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/th-lange/openflow/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/th-lange/openflow/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/th-lange/openflow/releases/tag/v0.2.6
