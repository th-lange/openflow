# Usage

The everyday path: running workflows and seeing what's available. For authoring workflows and the full configuration reference, see [Extension](./extension.md).

## Run a workflow

```
/workflow feature
```

The commander looks up the workflow, announces its plan, and executes each step in sequence. Pass your task description directly after the command:

```
/workflow feature

The parseDate() function in src/utils/date.ts throws on empty string.
It should return null instead.
```

The commander runs code-driven patterns via `run_workflow` — fan-out and parallel branches execute concurrently, and iteration/round limits are enforced in code, not left to the model.

## List available workflows

```
/workflow
```

With no workflow name, the commander calls `list_workflows` and displays what's defined in `openflow.json`. Disabled workflows are not shown by default — ask to include them (`include_disabled`) to see the full list. Entries are tagged `[disabled]` or `[locked]` where applicable.

## Built-in agents

Shipped in this repo's [`opencode.json`](../opencode.json). Run a workflow that uses them, or reference them when authoring your own.

| Agent | Model | Permissions | Role |
|-------|-------|-------------|------|
| `commander` | default | — | Primary agent; orchestrates all workflows |
| `workflow-builder` | default | read-only | Primary agent; interactively designs sequential workflows (`/build-workflow`) |
| `composer` | default | read-only | Turns vague requests into structured task briefs |
| `coder` | default | edit + bash | Implements changes; produces handoff summaries |
| `coder-weak` | haiku | edit + bash | Fast, minimal coder for simple tasks |
| `coder-strong` | opus | edit + bash | Thorough, careful coder for complex tasks |
| `analyzer` | default | read-only | Reviews code for correctness, security, and simplicity |
| `complexity-gate` | haiku | read-only | Classifies tasks as simple / medium / complex |
| `openflow-echo` | default | read-only | Test agent — echoes instructions verbatim |

## Sample workflows

The repo's [`openflow.json`](../openflow.json) contains ready-to-use examples. Copy any you want into your project's `openflow.json`.

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

Next: [Extension](./extension.md) · Back: [Install](./install.md)
