# Install

Getting openflow into OpenCode.

## Requirements

- [OpenCode CLI](https://opencode.ai) — `opencode` must be on your PATH
- Node.js 20+
- An LLM provider configured in OpenCode

## 1. Install the package

```bash
git clone https://github.com/th-lange/openflow.git
cd openflow
npm install
npm link
```

## 2. Configure (global or per-project)

Run in any directory:

```bash
openflow install
```

With no argument, this installs into OpenCode's global config dir (`~/.config/opencode/` on Linux/Mac, `%APPDATA%\opencode` on Windows), so the openflow tools and agents are available in every project automatically.

To install into a specific project instead:

```bash
openflow install /path/to/project
```

Either way, the command registers, in `opencode.jsonc` / `opencode.json`:

- the openflow **plugin** (an absolute `file://` entry under `plugin`),
- the `/workflow` and `/build-workflow` slash commands,
- all built-in agent definitions under `agent`.

Re-running is safe — existing entries are never overwritten, and comments/formatting in your config are preserved.

## 3. Create `openflow.json` in your project

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

See [Extension](./extension.md) for every pattern and the full field reference. You don't have to hand-write this file — `/build-workflow` builds workflows interactively (see [Usage](./usage.md)).

## 4. Start OpenCode

```bash
opencode
```

OpenCode loads the openflow plugin on startup and validates `openflow.json` — unknown agents, dangling workflow references, and cycles are reported in the OpenCode logs. Nine tools become available: `run_workflow`, `delegate_task`, `get_workflow`, `list_workflows`, `list_agents`, `create_workflow`, `create_agent`, `enable_workflow`, `disable_workflow`.

The `/workflow` command routes directly to the `commander` agent regardless of which agent is currently active in your session.

## Verify it loaded

- `/workflow` with no argument lists the workflows defined in `openflow.json`.
- A malformed `openflow.json` surfaces a validation error in the OpenCode logs at startup; a valid one loads silently.

## Uninstall

There's no uninstall command — remove the entries `openflow install` added from your `opencode.json` / `opencode.jsonc`: the `plugin` entry pointing at openflow, the `workflow` / `build-workflow` commands, and any openflow `agent` definitions you no longer want. Then `npm unlink openflow` (or remove the clone).

---

Next: [Usage](./usage.md) · [Extension](./extension.md)
