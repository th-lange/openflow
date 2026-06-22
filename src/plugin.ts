import type { Plugin, PluginInput, Hooks, Config } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import { z } from "zod";
import { delegateTask } from "./tools/delegate-task.js";
import {
  getWorkflow,
  listWorkflows,
  summariseWorkflow,
  isValidWorkflow,
} from "./tools/workflow-tools.js";
import { createWorkflow, createAgent, enableWorkflow, disableWorkflow } from "./tools/management-tools.js";
import { listAgents, formatModel, agentModelLabel } from "./config/agent-registry.js";
import { runWorkflow } from "./tools/run-workflow.js";
import { titleSession } from "./tools/session-title.js";
import { loadWorkflows, resolveSettings } from "./config/workflow-loader.js";
import { UsageLedger, formatUsageFooter } from "./state/usage-ledger.js";
import { createWorkflowArgs, createAgentArgs } from "./tools/schemas.js";
import { loadBuiltins, loadUserAgents, mergeInjectables } from "./config/agent-injector.js";

// Native OpenCode plugin entrypoint (ADR 0001 / #39).
//
// The plugin host injects an already-connected `client` plus the correct
// `directory`, so the deterministic engine spawns child sessions directly — no
// OPENCODE_URL/OPENCODE_CWD guessing. Tools are registered via the `tool()`
// helper and use the per-call ToolContext (directory, sessionID, abort) for
// path resolution and cancellation.
export const openflow: Plugin = async ({ client, directory }: PluginInput): Promise<Hooks> => {
  // Validate openflow.json once at startup; log problems without bricking the host (#34).
  loadWorkflows(client, directory).catch((e: unknown) => {
    console.error(
      `[openflow] openflow.json failed validation: ${e instanceof Error ? e.message : String(e)}`
    );
  });

  return {
    // Single-file install (#79): inject openflow's built-in agents/commands and
    // any user agents from openflow.json into the host config at load, instead
    // of `openflow install` copying them into opencode.json. Best-effort —
    // names already present in the host config are never clobbered, and any
    // failure is logged without bricking the host.
    config: async (config: Config) => {
      try {
        const [builtins, userAgents] = await Promise.all([
          loadBuiltins(),
          loadUserAgents(directory),
        ]);
        const added = mergeInjectables(config, builtins, userAgents);
        if (added.agents.length > 0 || added.commands.length > 0) {
          console.error(
            `[openflow] injected ${added.agents.length} agent(s)` +
              `${added.commands.length ? ` and ${added.commands.length} command(s)` : ""}`
          );
        }
      } catch (e: unknown) {
        console.error(
          `[openflow] agent/command injection failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    },

    tool: {
      get_workflow: tool({
        description:
          "Look up a workflow definition by name. Returns the full config including pattern, sequence or agents, and constraints.",
        args: { name: z.string().describe("Workflow name as defined in openflow.json") },
        async execute({ name }, ctx) {
          const workflow = await getWorkflow(name, ctx.directory);
          return JSON.stringify(workflow, null, 2);
        },
      }),

      list_workflows: tool({
        description: "List workflows defined in openflow.json. By default only enabled workflows are shown.",
        args: {
          include_disabled: z
            .boolean()
            .optional()
            .describe("Include disabled workflows in the listing (default: false)"),
        },
        async execute({ include_disabled }, ctx) {
          const workflows = await listWorkflows(ctx.directory, include_disabled ?? false);
          if (workflows.length === 0) return "No workflows defined in openflow.json.";
          return workflows
            .map((w) => {
              const tag = `${w.disabled ? " [disabled]" : ""}${"locked" in w && w.locked ? " [locked]" : ""}`;
              if (!isValidWorkflow(w)) return `- ${w.name}${tag} ⚠ invalid: ${w.error}`;
              return `- ${w.name}${tag}${w.description ? `: ${w.description}` : ""} (${summariseWorkflow(w)})`;
            })
            .join("\n");
        },
      }),

      list_agents: tool({
        description:
          "List the agents available in this project (from opencode.json). Use this to discover valid agent names before referencing them in a workflow.",
        args: {
          mode: z
            .enum(["subagent", "primary", "all"])
            .optional()
            .describe("Filter to agents of this mode (default: all modes)"),
        },
        async execute({ mode }) {
          const agents = await listAgents(client, mode);
          if (agents.length === 0) return "No agents found.";
          return agents
            .map((a) => {
              const model = formatModel(a.model);
              return `- ${a.name} (${a.mode})${model ? ` [${model}]` : ""}${a.description ? `: ${a.description}` : ""}`;
            })
            .join("\n");
        },
      }),

      run_workflow: tool({
        description:
          "Execute a workflow in code. Runs the pattern (sequential, evaluator-optimizer, conditional, fanout, parallel, debate), threads context, and returns the complete result. Do NOT use for orchestrator workflows — drive those via delegate_task loops.",
        args: {
          name: z.string().describe("Workflow name as defined in openflow.json"),
          prompt: z.string().describe("Task description passed through all steps"),
          context: z.string().optional().describe("Prior context to prepend to step 1"),
        },
        async execute({ name, prompt, context }, ctx) {
          // Best-effort breadcrumb: title the session after the workflow (#60).
          await titleSession(client, ctx.sessionID, name);
          return await runWorkflow(name, prompt, context, ctx.sessionID, client, ctx.directory, ctx.abort);
        },
      }),

      delegate_task: tool({
        description:
          "Delegate work to a named OpenCode agent in a child session. Returns the agent's complete text response.",
        args: {
          agent: z.string().describe("Name of the agent (must exist in opencode.json)"),
          prompt: z.string().describe("Task prompt to send to the agent"),
          context: z.string().optional().describe("Prior step outputs to prepend as context"),
        },
        async execute({ agent, prompt, context }, ctx) {
          const settings = await resolveSettings(ctx.directory);
          const ledger = new UsageLedger();
          const model = await agentModelLabel(client, agent);
          const { result } = await delegateTask(
            { agent, prompt, context, sessionId: ctx.sessionID },
            client,
            ctx.abort,
            settings.agentTimeoutMs,
            ledger
          );
          const header = `**${agent}**${model ? ` (${model})` : ""}`;
          return `${header}\n\n${result}${formatUsageFooter(ledger)}`;
        },
      }),

      create_workflow: tool({
        description:
          "Create or update a workflow definition in openflow.json. Supports all patterns; the entry is validated (shape, agents, workflow references, cycles) before it is persisted.",
        args: createWorkflowArgs,
        async execute(args, ctx) {
          return await createWorkflow(args, client, ctx.directory);
        },
      }),

      create_agent: tool({
        description:
          "Create or update an agent definition in opencode.json. OpenCode must reload before the new agent is usable.",
        args: createAgentArgs,
        async execute(args, ctx) {
          return await createAgent(args, ctx.directory);
        },
      }),

      enable_workflow: tool({
        description: "Enable a previously disabled workflow so it appears in list_workflows and can be run.",
        args: { name: z.string().describe("Workflow name as defined in openflow.json") },
        async execute({ name }, ctx) {
          return await enableWorkflow(name, ctx.directory);
        },
      }),

      disable_workflow: tool({
        description:
          "Disable a workflow so it is hidden from list_workflows and cannot be run. The definition is preserved and can be re-enabled later.",
        args: { name: z.string().describe("Workflow name as defined in openflow.json") },
        async execute({ name }, ctx) {
          return await disableWorkflow(name, ctx.directory);
        },
      }),
    },
  };
};

export default openflow;
