import { tool } from "@opencode-ai/plugin/tool";
import { z } from "zod";
import { delegateTask } from "./tools/delegate-task.js";
import { getWorkflow, listWorkflows, summariseWorkflow, isValidWorkflow, } from "./tools/workflow-tools.js";
import { createWorkflow, createAgent, enableWorkflow, disableWorkflow } from "./tools/management-tools.js";
import { runWorkflow } from "./tools/run-workflow.js";
import { loadWorkflows } from "./config/workflow-loader.js";
import { createWorkflowArgs, createAgentArgs } from "./tools/schemas.js";
// Native OpenCode plugin entrypoint (ADR 0001 / #39).
//
// The plugin host injects an already-connected `client` plus the correct
// `directory`, so the deterministic engine spawns child sessions directly — no
// OPENCODE_URL/OPENCODE_CWD guessing. Tools are registered via the `tool()`
// helper and use the per-call ToolContext (directory, sessionID, abort) for
// path resolution and cancellation.
export const openflow = async ({ client, directory }) => {
    // Validate openflow.json once at startup; log problems without bricking the host (#34).
    loadWorkflows(client, directory).catch((e) => {
        console.error(`[openflow] openflow.json failed validation: ${e instanceof Error ? e.message : String(e)}`);
    });
    return {
        tool: {
            get_workflow: tool({
                description: "Look up a workflow definition by name. Returns the full config including pattern, sequence or agents, and constraints.",
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
                    if (workflows.length === 0)
                        return "No workflows defined in openflow.json.";
                    return workflows
                        .map((w) => {
                        const tag = w.disabled ? " [disabled]" : "";
                        if (!isValidWorkflow(w))
                            return `- ${w.name}${tag} ⚠ invalid: ${w.error}`;
                        return `- ${w.name}${tag}${w.description ? `: ${w.description}` : ""} (${summariseWorkflow(w)})`;
                    })
                        .join("\n");
                },
            }),
            run_workflow: tool({
                description: "Execute a workflow in code. Runs the pattern (sequential, evaluator-optimizer, conditional, fanout, parallel, debate), threads context, and returns the complete result. Do NOT use for orchestrator workflows — drive those via delegate_task loops.",
                args: {
                    name: z.string().describe("Workflow name as defined in openflow.json"),
                    prompt: z.string().describe("Task description passed through all steps"),
                    context: z.string().optional().describe("Prior context to prepend to step 1"),
                },
                async execute({ name, prompt, context }, ctx) {
                    return await runWorkflow(name, prompt, context, ctx.sessionID, client, ctx.directory, ctx.abort);
                },
            }),
            delegate_task: tool({
                description: "Delegate work to a named OpenCode agent in a child session. Returns the agent's complete text response.",
                args: {
                    agent: z.string().describe("Name of the agent (must exist in opencode.json)"),
                    prompt: z.string().describe("Task prompt to send to the agent"),
                    context: z.string().optional().describe("Prior step outputs to prepend as context"),
                },
                async execute({ agent, prompt, context }, ctx) {
                    const { result } = await delegateTask({ agent, prompt, context, sessionId: ctx.sessionID }, client, ctx.abort);
                    return result;
                },
            }),
            create_workflow: tool({
                description: "Create or update a workflow definition in openflow.json. Supports all patterns; the entry is validated (shape, agents, workflow references, cycles) before it is persisted.",
                args: createWorkflowArgs,
                async execute(args, ctx) {
                    return await createWorkflow(args, client, ctx.directory);
                },
            }),
            create_agent: tool({
                description: "Create or update an agent definition in opencode.json. OpenCode must reload before the new agent is usable.",
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
                description: "Disable a workflow so it is hidden from list_workflows and cannot be run. The definition is preserved and can be re-enabled later.",
                args: { name: z.string().describe("Workflow name as defined in openflow.json") },
                async execute({ name }, ctx) {
                    return await disableWorkflow(name, ctx.directory);
                },
            }),
        },
    };
};
export default openflow;
//# sourceMappingURL=plugin.js.map