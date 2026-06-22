# openflow

> ⚠️ **BETA** — APIs and config formats will change. Not for production use.

Multi-step workflow orchestration for [OpenCode](https://opencode.ai). Define named sequences of specialised agents and run them with a single slash command. Seven coordination patterns are available — from simple pipelines to complexity-gated routing, parallel execution, and iterative quality loops.

## Quickstart

```bash
git clone https://github.com/th-lange/openflow.git
cd openflow && npm install && npm link
openflow install            # registers the openflow plugin in OpenCode (one line; agents + commands come from the plugin)
```

Then create an `openflow.json` in your project (or run `/build-workflow` to build one interactively) and start OpenCode:

```json
{
  "workflows": {
    "feature": {
      "sequence": ["composer", "coder", "analyzer"]
    }
  }
}
```

```
/workflow feature
```

The commander looks up the workflow, runs each step in code (threading context, enforcing limits, running parallel branches concurrently), and relays the result.

## Documentation

- **[Install](./docs/install.md)** — requirements, the `openflow install` CLI, verifying it loaded, uninstall.
- **[Usage](./docs/usage.md)** — running and listing workflows, the built-in agents, ready-to-use sample workflows.
- **[Extension](./docs/extension.md)** — authoring workflows (`/build-workflow` + `create_workflow`), engine settings, all seven patterns and their options, composition, the `locked` flag, and defining custom agents.

## Development

```bash
npm test       # Unit tests (no LLM needed)
npm run build  # Regenerate opencode.json agents from src/agents/*.md, then tsc → dist/
npm run proto  # Validate session spawning works in your environment
npm run e2e    # Full E2E suite — requires a running OpenCode server and LLM (~5 min)
```

Agent prompts are authored in `src/agents/<name>.md` (a metadata block plus the prompt body) and generated into `opencode.json` by `npm run build:agents`, which `npm run build` runs first. Edit the `.md` files, not the JSON. The plugin entrypoint is `src/plugin.ts` (built to `dist/plugin.js`); CI fails if the committed `dist/` or `opencode.json` drifts from a fresh build.

## License

MIT
