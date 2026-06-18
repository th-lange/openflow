# openflow

> ⚠️ **BETA** — APIs and config formats will change. Not for production use.

Multi-step workflow orchestration for [OpenCode](https://opencode.ai). Define named sequences of specialised agents and run them with a single slash command. Seven coordination patterns are available — from simple pipelines to complexity-gated routing, parallel execution, and iterative quality loops.

---

## Table of Contents

1. [Installation](#1-installation)
2. [Usage](#2-usage)
3. [Configuration](#3-configuration)
4. [Options](#4-options)

---

## 1. Installation

### Requirements

- [OpenCode CLI](https://opencode.ai) — `opencode` must be on your PATH
- Node.js 20+
- An LLM provider configured in OpenCode

### 1.1 Install

```bash
git clone https://github.com/th-lange/openflow.git
cd openflow
npm install
npm link
```

### 1.2 Configure your project

Run in any directory:

```bash
openflow install
```

With no argument, this installs into OpenCode's global config dir (`~/.config/opencode/` on Linux/Mac, `%APPDATA%\opencode` on Windows), so the openflow tools and agents are available in every project automatically.

To install into a specific project instead:

```bash
openflow install /path/to/project
```

Either way, the command registers the openflow **plugin**, the `/workflow` slash command, and all agent definitions in `opencode.jsonc` / `opencode.json`. Re-running is safe — existing entries are never overwritten. Comments and formatting in your config are preserved.

### 1.3 Create `openflow.json` in your project

Define the workflows you want:

```json
{
  "workflows": {
    "feature": {
      "description": "Full development cycle",
      "sequence": ["composer", "coder", "analyzer"],
      "commanderMayAlsoUse": ["composer", "coder", "analyzer"]
    }
  }
}
```

See [Configuration](#3-configuration) for all patterns and [Options](#4-options) for the full field reference.

### 1.4 Start OpenCode

```bash
opencode
```

OpenCode loads the openflow plugin on startup and validates `openflow.json` (unknown agents, dangling workflow references, and cycles are reported in the OpenCode logs). Eight tools become available: `run_workflow`, `delegate_task`, `get_workflow`, `list_workflows`, `create_workflow`, `create_agent`, `enable_workflow`, `disable_workflow`.

The commander runs code-driven patterns via `run_workflow` — fan-out and parallel branches execute concurrently, and iteration/round limits are enforced in code, not left to the model.

The `/workflow` command routes directly to the `commander` agent regardless of which agent is currently active in your session.

---

## 2. Usage

### Run a workflow

```
/workflow feature
```

The commander looks up the workflow, announces its plan, and executes each step in sequence. Pass your task description directly after the command:

```
/workflow feature

The parseDate() function in src/utils/date.ts throws on empty string.
It should return null instead.
```

### List available workflows

```
/workflow
```

With no workflow name, the commander calls `list_workflows` and displays what's defined in `openflow.json`. Disabled workflows are not shown by default — ask to include them to see the full list.

### Create a workflow

```
Create a workflow called "hotfix" that runs coder then analyzer,
with the description "Fast path for urgent fixes".
```

The commander calls `create_workflow`, which supports every pattern (not just sequential). The new entry is validated — shape, referenced agents, workflow references, and cycles — before it is written to `openflow.json`, and rolled back if invalid. Available immediately — no restart needed.

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

The commander calls `disable_workflow` or `enable_workflow`. Disabled workflows are hidden from `list_workflows` and cannot be run, but the definition is preserved and can be re-enabled at any time.

To see disabled workflows alongside enabled ones:

```
List all workflows including disabled ones.
```

The commander calls `list_workflows` with `include_disabled: true`. Disabled entries are marked `[disabled]` in the output.

You can also set the flag directly in `openflow.json`:

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

---

## 3. Configuration

### openflow.json structure

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

### Engine settings

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

Environment variables override the file (useful for per-machine tuning without editing config): `OPENFLOW_AGENT_TIMEOUT_MS` and `OPENFLOW_MAX_CONCURRENT`. Invalid values (non-positive timeout, non-integer concurrency) are rejected at startup.

### Workflow patterns

| Pattern | Description |
|---------|-------------|
| `sequential` | Fixed agent sequence; each step receives prior output as context |
| `orchestrator` | A primary agent dynamically decides which agents to call and in what order |
| `evaluator-optimizer` | Producer generates; evaluator scores; loops until pass or max iterations |
| `conditional` | A router agent classifies the request and dispatches to the matching workflow |
| `fanout` | Same task sent to N agents; a picker selects the best result |
| `parallel` | Independent subtasks run concurrently; a merger consolidates results |
| `debate` | Proposer and critic alternate; a judge delivers a verdict on the transcript |

### Workflow composition

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

### Agent definitions

Agents are defined in your project's `opencode.json` under `"agent"`. The built-in agents in this repo's `opencode.json` can be copied as-is. Changes to `opencode.json` require an OpenCode restart before new agents are usable.

---

## 4. Options

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
| `description` | no | — | Shown in `list_workflows` |
| `disabled` | no | `false` | Hide from listing and block execution |

#### Sequence step types

| Form | Example | Behaviour |
|------|---------|-----------|
| Agent name | `"coder"` | Delegates to that agent |
| Workflow reference | `{ "workflow": "implement" }` | Executes the named workflow inline |
| Checkpoint | `{ "checkpoint": "Review before continuing." }` | Pauses and prompts the user to confirm before proceeding |

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
| `disabled` | boolean | `false` | Hide from `list_workflows` and block execution. Can be toggled via the `enable_workflow` and `disable_workflow` tools. Agent references are not validated for disabled workflows. |

### Agent fields

```json
{
  "agent": {
    "my-agent": {
      "description": "One-line summary shown in tool listings",
      "mode": "subagent",
      "model": "anthropic/claude-haiku-4-5",
      "prompt": "You are ...",
      "permission": {
        "edit": "allow",
        "bash": "deny"
      },
      "tools": {}
    }
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

### Built-in agents

Defined in this repo's [`opencode.json`](./opencode.json) — copy the entries you need into your project.

| Agent | Model | Permissions | Role |
|-------|-------|-------------|------|
| `commander` | default | — | Primary agent; orchestrates all workflows |
| `composer` | default | read-only | Turns vague requests into structured task briefs |
| `coder` | default | edit + bash | Implements changes; produces handoff summaries |
| `coder-weak` | haiku | edit + bash | Fast, minimal coder for simple tasks |
| `coder-strong` | opus | edit + bash | Thorough, careful coder for complex tasks |
| `analyzer` | default | read-only | Reviews code for correctness, security, and simplicity |
| `complexity-gate` | haiku | read-only | Classifies tasks as simple / medium / complex |
| `openflow-echo` | default | read-only | Test agent — echoes instructions verbatim |

### Sample workflows

The repo's [`openflow.json`](./openflow.json) contains ready-to-use examples. Copy any you want into your project's `openflow.json`.

| Workflow | Pattern | Description |
|----------|---------|-------------|
| `feature` | sequential | composer → coder → analyzer |
| `implement` | sequential | coder → analyzer |
| `review` | sequential | analyzer only |
| `guarded-feature` | sequential | Feature cycle with human checkpoints before implementation and before review |
| `quality-implement` | evaluator-optimizer | coder iterates until analyzer gives PASS (max 3) |
| `best-of-3` | fanout | 3 independent coder runs; analyzer picks the best |
| `parallel-review` | parallel | 3 concurrent analyzer passes (correctness / security / performance) |
| `arch-debate` | debate | composer proposes, analyzer critiques (2 rounds), analyzer judges |
| `auto-route` | conditional | composer classifies bug / feature / review and dispatches accordingly |
| `complexity-route` | conditional | composer routes simple → `implement` or complex → `quality-implement` |
| `smart-implement` | conditional | complexity-gate routes to `implement-simple` / `implement` / `implement-premium` by tier |
| `implement-simple` | sequential | coder-weak only — fast, no review step |
| `implement-premium` | evaluator-optimizer | coder-strong iterates until analyzer gives PASS (max 4) |
| `feature-smart` | sequential | composer → smart-implement (composed) → analyzer |
| `smart-dev` | orchestrator | Dynamic — commander decides which agents to call at runtime |

---

## Development

```bash
npm test       # Unit tests (~300 ms, no LLM needed)
npm run build  # Regenerate opencode.json agents from src/agents/*.md, then tsc → dist/
npm run proto  # Validate session spawning works in your environment
npm run e2e    # Full E2E suite — requires a running OpenCode server and LLM (~5 min)
```

Agent prompts are authored in `src/agents/<name>.md` (a metadata block plus the
prompt body) and generated into `opencode.json` by `npm run build:agents`, which
`npm run build` runs first. Edit the `.md` files, not the JSON. The plugin
entrypoint is `src/plugin.ts` (built to `dist/plugin.js`); CI fails if the
committed `dist/` or `opencode.json` drifts from a fresh build.

---

## License

MIT
