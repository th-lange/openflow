import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { delegateTask, DelegateTaskInputSchema } from "./tools/delegate-task.js";

const SERVER_URL = process.env.OPENCODE_URL ?? "http://127.0.0.1:4096";

const server = new McpServer({
  name: "openflow",
  version: "1.0.0",
});

// ── delegate_task tool ────────────────────────────────────────────────────────

server.tool(
  "delegate_task",
  "Delegate work to a named OpenCode agent in a child session. Returns the agent's complete text response.",
  {
    agent: z.string().describe("Name of the agent to delegate to (must be defined in opencode.json)"),
    prompt: z.string().describe("Task prompt to send to the agent"),
    context: z.string().optional().describe("Prior step outputs to inject before the prompt"),
    sessionId: z.string().optional().describe("Parent session ID for workflow step tracking"),
  },
  async ({ agent, prompt, context, sessionId }) => {
    const output = await delegateTask({ agent, prompt, context, sessionId }, SERVER_URL);
    return {
      content: [
        {
          type: "text",
          text: output.result,
        },
      ],
    };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
