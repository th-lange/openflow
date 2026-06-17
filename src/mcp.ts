import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { delegateTask } from "./tools/delegate-task.js";
import { getWorkflow, listWorkflows, summariseWorkflow } from "./tools/workflow-tools.js";
import { createWorkflow, createAgent } from "./tools/management-tools.js";
import { runWorkflow } from "./tools/run-workflow.js";
import { createOpencodeClient } from "@opencode-ai/sdk";

const SERVER_URL = process.env.OPENCODE_URL ?? "http://127.0.0.1:4096";
const WORK_DIR = process.env.OPENCODE_CWD ?? process.cwd();
const client = createOpencodeClient({ baseUrl: SERVER_URL });

const server = new McpServer({
  name: "openflow",
  version: "1.0.0",
});

// ── delegate_task ─────────────────────────────────────────────────────────────

server.tool(
  "delegate_task",
  "Delegate work to a named OpenCode agent in a child session. Returns the agent's complete text response.",
  {
    agent: z.string().describe("Name of the agent (must exist in opencode.json)"),
    prompt: z.string().describe("Task prompt to send to the agent"),
    context: z.string().optional().describe("Prior step outputs to prepend as context"),
    sessionId: z.string().optional().describe("Parent session ID for step tracking"),
  },
  async ({ agent, prompt, context, sessionId }) => {
    const output = await delegateTask({ agent, prompt, context, sessionId }, SERVER_URL);
    return { content: [{ type: "text", text: output.result }] };
  }
);

// ── run_workflow ──────────────────────────────────────────────────────────────

server.tool(
  "run_workflow",
  "Execute a sequential workflow in code. Runs all steps in order, threads context between them, and returns the complete result. Do NOT use for orchestrator workflows — handle those yourself via delegate_task loops as instructed.",
  {
    name: z.string().describe("Workflow name as defined in openflow.json"),
    prompt: z.string().describe("Task description passed through all steps"),
    context: z.string().optional().describe("Prior context to prepend to step 1"),
    sessionId: z.string().optional().describe("Parent session ID for step tracking"),
  },
  async ({ name, prompt, context, sessionId }) => {
    const result = await runWorkflow(name, prompt, context, sessionId, SERVER_URL, WORK_DIR);
    return { content: [{ type: "text", text: result }] };
  }
);

// ── get_workflow ──────────────────────────────────────────────────────────────

server.tool(
  "get_workflow",
  "Look up a workflow definition by name. Returns the full config including pattern, sequence or agents, and constraints.",
  {
    name: z.string().describe("Workflow name as defined in openflow.json"),
  },
  async ({ name }) => {
    const workflow = await getWorkflow(name, WORK_DIR);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(workflow, null, 2),
        },
      ],
    };
  }
);

// ── list_workflows ────────────────────────────────────────────────────────────

server.tool(
  "list_workflows",
  "List all available workflows defined in openflow.json.",
  {},
  async () => {
    const workflows = await listWorkflows(WORK_DIR);
    if (workflows.length === 0) {
      return { content: [{ type: "text", text: "No workflows defined in openflow.json." }] };
    }
    const text = workflows
      .map(
        (w) =>
          `- ${w.name}${w.description ? `: ${w.description}` : ""} (${summariseWorkflow(w)})`
      )
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

// ── create_workflow ───────────────────────────────────────────────────────────

server.tool(
  "create_workflow",
  "Create or update a workflow definition in openflow.json. Validates that all referenced agents exist.",
  {
    name: z.string().describe("Workflow identifier (used in /workflow <name>)"),
    sequence: z.array(z.string()).describe("Ordered list of agent names to run"),
    description: z.string().optional().describe("Short description shown by list_workflows"),
    commanderMayAlsoUse: z.array(z.string()).optional().describe("Agents the commander may deviate to (defaults to sequence)"),
    force: z.boolean().optional().describe("Overwrite if workflow already exists (default: false)"),
  },
  async ({ name, sequence, description, commanderMayAlsoUse, force }) => {
    const result = await createWorkflow(
      { name, sequence, description, commanderMayAlsoUse, force },
      client,
      WORK_DIR
    );
    return { content: [{ type: "text", text: result }] };
  }
);

// ── create_agent ──────────────────────────────────────────────────────────────

server.tool(
  "create_agent",
  "Create or update an agent definition in opencode.json. OpenCode must reload before the new agent is usable.",
  {
    name: z.string().describe("Agent identifier"),
    prompt: z.string().describe("System prompt for the agent"),
    description: z.string().optional().describe("Short description of the agent's role"),
    mode: z.enum(["subagent", "primary", "all"]).optional().describe("Agent mode (default: subagent)"),
    model: z.string().optional().describe("Model to use, e.g. anthropic/claude-sonnet-4-5"),
    allowEdit: z.boolean().optional().describe("Allow file edits (default: false)"),
    allowBash: z.boolean().optional().describe("Allow bash commands (default: false)"),
    force: z.boolean().optional().describe("Overwrite if agent already exists (default: false)"),
  },
  async ({ name, prompt, description, mode, model, allowEdit, allowBash, force }) => {
    const result = await createAgent(
      { name, prompt, description, mode, model, allowEdit, allowBash, force },
      WORK_DIR
    );
    return { content: [{ type: "text", text: result }] };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
