# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(pre-1.0: minor/patch bumps may include behavioural changes — see the BETA notice in the README).

## [Unreleased]

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
