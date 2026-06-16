import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { delegateTask } from "./tools/delegate-task.js";
import { getWorkflow, listWorkflows } from "./tools/workflow-tools.js";

const SERVER_URL = process.env.OPENCODE_URL ?? "http://127.0.0.1:4096";
const WORK_DIR = process.env.OPENCODE_CWD ?? process.cwd();

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

// ── get_workflow ──────────────────────────────────────────────────────────────

server.tool(
  "get_workflow",
  "Look up a workflow definition by name. Returns the ordered agent sequence and permitted deviations.",
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
      .map((w) => `- ${w.name}${w.description ? `: ${w.description}` : ""} (${w.sequence.join(" → ")})`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
