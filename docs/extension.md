# Extension

Authoring your own workflows and agents, plus the full configuration reference.

## Contents

- [Authoring workflows](#authoring-workflows)
- [`openflow.json` structure](#openflowjson-structure)
- [Engine settings](#engine-settings)
- [Token efficiency](#token-efficiency)
- [Workflow patterns](#workflow-patterns)
- [Workflow composition](#workflow-composition)
- [Pattern options reference](#pattern-options-reference)
- [Agents](#agents)

---

## Authoring workflows

### Build a workflow interactively

```
/build-workflow
```

`/build-workflow` activates the **`workflow-builder`** agent, which interviews you element by element — name, then each step in turn (an agent task, a `{ checkpoint }` pause, or a nested `{ workflow }`) — and writes the result to `openflow.json` once you confirm. It builds **sequential, commander-supervised** workflows and validates every agent/workflow reference as it goes (via `list_agents` / `list_workflows`). Run `/build-workflow` again and choose *modify* to edit an existing sequential workflow's steps. For the other six patterns, ask the commander to use `create_workflow` directly.

### Create a workflow (any pattern)

```
Create a workflow called "hotfix" that runs coder then analyzer,
with the description "Fast path for urgent fixes".
```

The commander calls `create_workflow`, which supports every pattern. The new entry is validated — shape, referenced agents, workflow references, and cycles — before it is written to `openflow.json`, and rolled back if invalid. Available immediately — no restart needed.

### Create an agent

```
Create an agent called "documenter" that writes JSDoc comments for
TypeScript functions. It should be read-only with no bash access.
```

The commander calls `create_agent` and writes to `opencode.json`. **Restart OpenCode** after creating an agent before it can be used in workflows.

### Enable and disable workflows

```
Disable the "draft-feature" workflow.
Enable the "draft-feature" workflow.
```

The commander calls `disable_workflow` or `enable_workflow`. Disabled workflows are hidden from `list_workflows` and cannot be run, but the definition is preserved and can be re-enabled at any time. Set the flag directly in `openflow.json` if you prefer:

```json
{
  "workflows": {
    "draft-workflow": {
      "disabled": true,
      "sequence": ["composer", "coder"]
    }
  }
}
```

### Lock a workflow

Set `"locked": true` on a workflow to make it immutable. Locked workflows cannot be overwritten (even with `force`), enabled, or disabled by the management tools — useful for protecting a curated or shared workflow from accidental edits. Locked entries are marked `[locked]` in `list_workflows`, and the interactive builder refuses to modify them.

```json
{
  "workflows": {
    "release": {
      "locked": true,
      "sequence": ["composer", "coder", "analyzer"]
    }
  }
}
```

---

## `openflow.json` structure

All workflows live under a `"workflows"` key, each keyed by name:

```json
{
  "workflows": {
    "my-workflow": {
      "pattern": "sequential",
      "description": "What this workflow does",
      "sequence": ["composer", "coder", "analyzer"]
    }
  }
}
```

The `pattern` field selects the coordination strategy. Omitting it defaults to `"sequential"`.

### Global vs project workflows

openflow reads **two** `openflow.json` files and merges them:

- **Global** — `openflow.json` in OpenCode's config dir (`~/.config/opencode/` on Linux/Mac, `%APPDATA%\opencode` on Windows, or `$XDG_CONFIG_HOME/opencode`). A shared baseline of workflows available in **every** project.
- **Project** — `openflow.json` in the project directory. **Additive**: it introduces new workflows on top of the global set.

On a name collision **the global workflow wins** — a project cannot shadow or override a global one. To add a project-specific variant, give it a different name. `list_workflows` tags each entry `[global]` or `[project]` so you can see where it came from.

This mirrors how the built-in agents are provided (see [Agents](#agents)): define the shared things once at the global level; projects only ever extend. `create_workflow` and `/build-workflow` write to the **project** file by default, and warn if a name is already taken globally. Project workflows may freely reference global workflows and agents.

> **Settings** layer the other way: a project's `settings` block overrides the global one per key, since per-project tuning is the common case (env vars still win over both — see [Engine settings](#engine-settings)). A user `agents` block follows the workflow rule (global wins).

## Engine settings

An optional top-level `"settings"` block tunes the execution engine. Both fields are optional; omitted values fall back to the defaults below.

```json
{
  "settings": {
    "agentTimeoutMs": 300000,
    "maxConcurrent": 5
  },
  "workflows": { ... }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `agentTimeoutMs` | `300000` (5 min) | Per-agent delegation timeout in milliseconds. A delegation that exceeds it is aborted and reported as a failure. |
| `maxConcurrent` | `5` | Maximum number of agents dispatched at once in `fanout` / `parallel` workflows. |
| `langfuse` | — | Optional [Langfuse](https://langfuse.com) tracing — see [Tracing](#tracing-langfuse). |

Environment variables override the file (useful for per-machine tuning without editing config): `OPENFLOW_AGENT_TIMEOUT_MS` and `OPENFLOW_MAX_CONCURRENT`. Invalid values (non-positive timeout, non-integer concurrency) are rejected at startup.

### Tracing (Langfuse)

Each workflow run can be emitted as a [Langfuse](https://langfuse.com) **trace**, with every agent delegation a **generation** carrying its model, input, output, token usage, cost, and latency — turning the inline cost footer into per-step, per-agent dashboards.

Tracing is **off by default**. To enable it:

1. Install the SDK in your project: `npm i langfuse`
2. Set the API keys in the environment: `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`
3. Turn it on in `openflow.json`:

```json
{
  "settings": {
    "langfuse": { "enabled": true, "host": "https://cloud.langfuse.com" }
  }
}
```

`host` is optional (falls back to `LANGFUSE_HOST`, then Langfuse cloud) — set it to your own URL for self-hosted Langfuse. Tracing is best-effort: if the package is missing, the keys are unset, or the backend is unreachable, the run proceeds normally and tracing silently no-ops.

> Tracing sends prompts and outputs to Langfuse. Keep it disabled for sensitive work, or self-host via `host`.

## Token efficiency

Most of a workflow's cost is tokens, and openflow gives you several levers to cut them without sacrificing quality. They compose — measure first with the footer, then dial in the rest.

### The cost footer

Every workflow run ends with a one-line footer aggregating token usage and cost across all steps (including nested patterns):

```
---
tokens: 12.3k in / 4.1k out · cache 82% read · ~$0.0412 · 5 steps
```

- **in / out** — total input and output tokens for the run.
- **cache N% read** — share of input served from the provider's prompt cache (higher is cheaper). Shown only when the provider reports cache reads.
- **~$** — total cost across steps, when the provider reports it.
- **steps** — number of agent delegations.

`delegate_task` shows the same footer for a single call. Use it to find the expensive steps before tuning.

### The levers

| Lever | What it does | Where |
|-------|--------------|-------|
| **Model routing** | Route easy work to a cheap model and reserve a strong model for hard tasks. `complexity-gate` classifies; `coder-weak` (haiku) / `coder` / `coder-strong` (opus) execute by tier — see `smart-implement` in [Usage](./usage.md#sample-workflows). | Agent `model` field + conditional/`complexity-gate` workflows |
| **`contextScope`** | Limit how many prior steps are threaded into each step (`all` / `last` / `none`). Cuts the O(n²) context growth on long sequences. | [Sequential](#sequential) field |
| **Structured handoffs (`compactContext`)** | Thread a compact handoff block between steps instead of the full transcript; downstream agents re-read files themselves. On by default. | [Structured handoffs](#structured-handoffs) |
| **Langfuse tracing** | Persist per-step token/cost/latency to dashboards for ongoing analysis. | [Tracing (Langfuse)](#tracing-langfuse) |

### Compatibility note

Since **v0.2.11**, compact context is the **default** for sequential workflows (`compactContext: true`): intermediate-step context and the relay use handoff blocks rather than full outputs. This reduces cost but changes what downstream steps see. To restore the previous full-output behaviour for a workflow, set `compactContext: false`.

## Workflow patterns

| Pattern | Description |
|---------|-------------|
| `sequential` | Fixed agent sequence; each step receives prior output as context |
| `orchestrator` | A primary agent dynamically decides which agents to call and in what order |
| `evaluator-optimizer` | Producer generates; evaluator scores; loops until pass or max iterations |
| `conditional` | A router agent classifies the request and dispatches to the matching workflow |
| `fanout` | Same task sent to N agents; a picker selects the best result |
| `parallel` | Independent subtasks run concurrently; a merger consolidates results |
| `debate` | Proposer and critic alternate; a judge delivers a verdict on the transcript |

## Workflow composition

Any workflow can be embedded as a step inside a sequential workflow using `{ "workflow": "name" }`:

```json
{
  "workflows": {
    "feature": {
      "sequence": ["composer", { "workflow": "smart-implement" }, "analyzer"]
    },
    "smart-implement": {
      "pattern": "conditional",
      "router": "complexity-gate",
      "routes": [
        { "condition": "simple",  "workflow": "implement-simple" },
        { "condition": "complex", "workflow": "implement-premium" }
      ],
      "default": "implement"
    }
  }
}
```

Rules:
- All workflows are defined flat at the top level — never nested in JSON
- Cycles (`a → b → a`) are detected and rejected at startup
- A workflow containing `checkpoint` steps cannot be referenced by another workflow (checkpoints require top-level commander execution)

---

## Pattern options reference

### Sequential

```json
{
  "pattern": "sequential",
  "sequence": ["composer", "coder", "analyzer"],
  "commanderMayAlsoUse": ["composer", "coder"],
  "description": "Full development cycle"
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `sequence` | yes | — | Ordered steps. Each is an agent name, `{ "workflow": "name" }`, or `{ "checkpoint": "message" }` |
| `commanderMayAlsoUse` | no | `[]` | Agents the commander may deviate to when a step fails |
| `contextScope` | no | `all` | How much prior-step output is threaded into each step: `all` (every prior step), `last` (previous step only), or `none` (no prior-step context). Lower scopes cut token cost on long sequences |
| `compactContext` | no | `true` | Thread compact **handoff** blocks between steps (and show intermediate steps as their handoff in the relay; the final step is always shown in full). Set `false` for full-output threading. See [Structured handoffs](#structured-handoffs) |
| `description` | no | — | Shown in `list_workflows` |
| `disabled` | no | `false` | Hide from listing and block execution |

#### Sequence step types

| Form | Example | Behaviour |
|------|---------|-----------|
| Agent name | `"coder"` | Delegates to that agent |
| Workflow reference | `{ "workflow": "implement" }` | Executes the named workflow inline |
| Checkpoint | `{ "checkpoint": "Review before continuing." }` | Pauses and prompts the user to confirm before proceeding |

#### Structured handoffs

By default (`compactContext: true`), sequential workflows thread a compact **handoff** between steps rather than each step's full transcript. An agent ends its response with a fenced block:

````
```handoff
**Files changed:** `src/utils/date.ts` — return null on empty input
**What was done:** guarded the parse and added the early return
**Risks to check:** callers that relied on the throw
```
````

The engine threads only that block to the next step; the downstream agent re-reads the named files via its own tools instead of receiving them inline. This keeps long pipelines from re-sending every prior step's output (the O(n²) cost). If an agent emits no block, its output is threaded truncated as a fallback. The built-in `composer`, `coder`, `coder-strong`, `coder-weak`, and `analyzer` agents all emit handoff blocks; custom agents should too. Set `compactContext: false` to restore full-output threading and a full relay.

### Orchestrator

```json
{
  "pattern": "orchestrator",
  "agents": ["composer", "coder", "analyzer"],
  "maxIterations": 6,
  "satisfactionCriteria": "The task is complete and the analyzer has confirmed no issues."
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `agents` | yes | — | Agents the orchestrator may call |
| `satisfactionCriteria` | yes | — | Condition the orchestrator evaluates to decide when to stop |
| `maxIterations` | no | `6` | Maximum delegation turns before stopping |
| `description` / `disabled` | no | — | See [Common fields](#common-fields) |

The orchestrator receives the task and decides at runtime which agents to call, in what order, and how many times. Unlike sequential, the sequence is not fixed.

### Evaluator-Optimizer

```json
{
  "pattern": "evaluator-optimizer",
  "producer": "coder",
  "evaluator": "analyzer",
  "maxIterations": 3,
  "passCriteria": "PASS"
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `producer` | yes | — | Agent that generates output |
| `evaluator` | yes | — | Agent that scores the output |
| `passCriteria` | no | `"PASS"` | String the evaluator's response must contain to exit the loop |
| `maxIterations` | no | `3` | Maximum producer/evaluator cycles |
| `description` / `disabled` | no | — | See [Common fields](#common-fields) |

On each iteration the evaluator's feedback is passed to the producer. The loop exits when `passCriteria` is matched or `maxIterations` is reached.

### Conditional

```json
{
  "pattern": "conditional",
  "router": "complexity-gate",
  "routes": [
    { "condition": "simple",  "workflow": "implement-simple" },
    { "condition": "medium",  "workflow": "implement" },
    { "condition": "complex", "workflow": "implement-premium" }
  ],
  "default": "implement"
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `router` | yes | — | Agent that classifies the request |
| `routes` | yes | — | Array of `{ condition, workflow }` mappings |
| `default` | yes | — | Workflow to run when no condition matches |
| `description` / `disabled` | no | — | See [Common fields](#common-fields) |

The router agent is instructed to return one of the condition labels as its output. Unrecognised labels fall back to `default`.

### Fan-out

```json
{
  "pattern": "fanout",
  "agents": ["coder", "coder", "coder"],
  "picker": "analyzer",
  "pickerPrompt": "Select the implementation with the best code quality and minimal surface area."
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `agents` | yes | — | Agents to run in parallel (duplicates allowed) |
| `picker` | yes | — | Agent that selects the best result |
| `pickerPrompt` | no | — | Extra instruction given to the picker |
| `description` / `disabled` | no | — | See [Common fields](#common-fields) |

All agents receive the same prompt and run concurrently. The picker receives all outputs and selects one winner.

### Parallel

```json
{
  "pattern": "parallel",
  "subtasks": [
    { "agent": "analyzer", "prompt": "Review for correctness and logic errors." },
    { "agent": "analyzer", "prompt": "Review for security vulnerabilities." },
    { "agent": "analyzer", "prompt": "Review for performance and readability." }
  ],
  "merger": "composer"
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `subtasks` | yes | — | Array of `{ agent, prompt }` — each runs independently and concurrently |
| `merger` | yes | — | Agent that consolidates all subtask outputs into a final result |
| `description` / `disabled` | no | — | See [Common fields](#common-fields) |

Unlike fan-out, each subtask has its own prompt. The original user prompt is forwarded to each subtask as context alongside its specific instruction.

### Debate

```json
{
  "pattern": "debate",
  "proposer": "composer",
  "critic": "analyzer",
  "rounds": 2,
  "judge": "analyzer"
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `proposer` | yes | — | Agent that makes the initial proposal and responds to critique |
| `critic` | yes | — | Agent that argues against the proposal |
| `judge` | yes | — | Agent that reviews the full transcript and delivers a verdict |
| `rounds` | no | `2` | Number of propose/critique cycles before the judge |
| `description` / `disabled` | no | — | See [Common fields](#common-fields) |

The full debate transcript is passed to each participant at every turn. The judge receives the complete exchange and returns a decision with reasoning.

### Common fields

Accepted by all patterns:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | string | — | Human-readable summary shown by `list_workflows` |
| `disabled` | boolean | `false` | Hide from `list_workflows` and block execution. Toggle via `enable_workflow` / `disable_workflow`. Agent references are not validated for disabled workflows. |
| `locked` | boolean | `false` | Make the workflow immutable — see [Lock a workflow](#lock-a-workflow). |

---

## Agents

The built-in agents (see [Usage](./usage.md#built-in-agents)) ship with the plugin and are injected into OpenCode automatically — you don't install or configure them.

### Defining your own agents

Add an optional top-level `"agents"` block to `openflow.json`, co-located with the workflows that use them. Each entry is a standard OpenCode agent config keyed by name:

```json
{
  "agents": {
    "documenter": {
      "description": "Writes JSDoc comments for TypeScript functions",
      "mode": "subagent",
      "model": "anthropic/claude-haiku-4-5",
      "prompt": "You add concise JSDoc comments. Do not change behaviour.",
      "permission": { "edit": "allow", "bash": "deny" },
      "tools": {}
    }
  },
  "workflows": {
    "document": { "sequence": ["documenter"] }
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `mode` | `subagent` | `subagent` (called by commander) or `primary` (user-facing) |
| `prompt` | — | System prompt — be specific about what the agent must and must not do |
| `model` | system default | Model override, e.g. `anthropic/claude-haiku-4-5` or `anthropic/claude-opus-4-8` |
| `permission.edit` | `deny` | `allow` or `deny` file edits |
| `permission.bash` | `deny` | `allow` or `deny` shell commands |
| `tools` | `{}` | Per-tool enable/disable map for the agent |

The plugin injects these at load (via its `config` hook), so they appear in `list_agents` and can be referenced by workflows — **restart OpenCode** after editing the block. Injection **never overwrites** an agent already defined in your `opencode.json`, and a name that collides with a built-in keeps the built-in, so don't reuse reserved names like `commander` or `workflow-builder`. The block is validated at startup; a malformed entry is reported in the OpenCode logs.

> The `create_agent` tool and a hand-written `"agent"` block in `opencode.json` still work (OpenCode's native location); the `agents` block above is the single-file equivalent and is preferred for openflow-owned agents.

### Authoring the built-in agents (this repo)

The built-in agent prompts are authored in `src/agents/<name>.md` (a metadata block plus the prompt body) and generated into `opencode.json` by `npm run build:agents`. Edit the `.md` files, not the JSON — CI fails if the committed `opencode.json` drifts from a fresh generate.

---

Back: [Install](./install.md) · [Usage](./usage.md)
