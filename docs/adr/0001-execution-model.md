# ADR 0001 — Execution model: native plugin + deterministic engine

- Status: Accepted
- Date: 2026-06-18
- Issues: #32 (decision), #33 (spike), #37, #38, #39, #43

## Context

openflow shipped a deterministic, code-driven execution engine (`run_workflow` / `delegate_task` and the `src/tools/run-*.ts` runners) that spawns child OpenCode sessions via `@opencode-ai/sdk`, threads context, enforces timeouts, cleans up sessions, caps concurrency, and parses structured `` ```openflow `` output blocks.

It is packaged as an **MCP `type: "local"` server** — a stdio subprocess OpenCode spawns. That subprocess builds its SDK client from `process.env.OPENCODE_URL ?? "http://127.0.0.1:4096"` (`src/mcp.ts:10`). OpenCode does not reliably inject its live server URL into the subprocess, so the engine's `client.session.*` calls hit a dead address. Commit `ea74ac9` reacted by making the LLM commander emulate every pattern through OpenCode's native task tool and forbidding `run_workflow`/`delegate_task` ("server mode that is not active"). That left the entire engine as dead code and dropped all of its guarantees (real concurrency, enforced iteration caps, structured outputs, timeouts).

## Decision

**Re-implement openflow as a native OpenCode plugin (`@opencode-ai/plugin`) and keep the deterministic, code-driven engine.** (Option A of #32.)

## Rationale

Spike #33 inspected `@opencode-ai/plugin@1.17.8`'s types and found:

- `PluginInput` provides an already-connected `client`, plus `serverUrl: URL`, `directory`, and `worktree`. This removes the `OPENCODE_URL`/`OPENCODE_CWD` guessing that caused the failure — the root cause was the MCP packaging, not the engine.
- Plugins register custom tools via `Hooks.tool` + the `tool({ description, args, execute })` helper, so every existing tool ports over.
- `ToolContext` exposes `directory`, `worktree`, and `abort: AbortSignal` per call (the AbortSignal also fixes the #45 timeout-abort bug).

Option A restores determinism, real concurrency, enforced limits, and structured outputs — the project's core value proposition — and aligns with the stated intent that openflow is "a plugin in opencode". Options C (commit to native delegation) and D (hybrid) were rejected because they sacrifice or fragment that value; Option B (stay on MCP, fix reachability) is not viable because OpenCode does not expose the server URL to MCP subprocesses.

## Consequences

- Port `src/mcp.ts` from `McpServer` (stdio) to an `@opencode-ai/plugin` module that returns `Hooks.tool` entries built with the `tool()` helper, using the injected `client` and `directory` instead of env/URL globals.
- The installer (`bin/openflow.mjs`) changes from registering an `mcp` server entry to registering a `plugin` entry in `opencode.json`.
- The commander prompt reverts to calling `run_workflow` for code-driven patterns; the "server mode not active" note is removed.
- `delegate_task` adopts the per-call `AbortSignal` for real cancellation (#45).
- Validation (`loadWorkflows`) is wired in and kept regardless (#34); the two parsers are consolidated (#38); README and pattern-fidelity docs are reconciled (#43, #37).
- Runtime end-to-end validation still requires a live OpenCode + LLM; the existing `src/proto/` scripts are adapted to the plugin context as the integration check.

## Status of follow-ups

- #33 closed (spike resolved).
- #34, #35, #36, #38, #41, #44, #45 are largely independent of this rearchitecture and proceed in parallel.
- The MCP→plugin port itself (this ADR's core consequence) is the large work item; tracked under #39's "code-driven branch" tasks plus a dedicated port issue.
