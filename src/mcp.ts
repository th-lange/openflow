import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { delegateTask } from "./tools/delegate-task.js";
import {
  getWorkflow,
  listWorkflows,
  summariseWorkflow,
  isValidWorkflow,
} from "./tools/workflow-tools.js";
import { createWorkflow, createAgent, enableWorkflow, disableWorkflow } from "./tools/management-tools.js";
import { runWorkflow } from "./tools/run-workflow.js";
import { loadWorkflows } from "./config/workflow-loader.js";
import { createOpencodeClient } from "@opencode-ai/sdk";

const SERVER_URL = process.env.OPENCODE_URL ?? "http://127.0.0.1:4096";
const WORK_DIR = process.env.OPENCODE_CWD ?? process.cwd();
const client = createOpencodeClient({ baseUrl: SERVER_URL });

// Validate openflow.json once at startup (#34). Errors (cycles, dangling
// references, unknown agents, malformed patterns) are logged to stderr, which
// OpenCode captures in its MCP server logs. We do not hard-exit: a single bad
// workflow should not prevent the management tools from being used to fix it.
loadWorkflows(client, WORK_DIR).catch((e: unknown) => {
  console.error(
    `[openflow] openflow.json failed validation: ${e instanceof Error ? e.message : String(e)}`
  );
});

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
  "List workflows defined in openflow.json. By default only enabled workflows are shown.",
  {
    include_disabled: z.boolean().optional().describe("Include disabled workflows in the listing (default: false)"),
  },
  async ({ include_disabled }) => {
    const workflows = await listWorkflows(WORK_DIR, include_disabled ?? false);
    if (workflows.length === 0) {
      return { content: [{ type: "text", text: "No workflows defined in openflow.json." }] };
    }
    const text = workflows
      .map((w) => {
        if (!isValidWorkflow(w)) {
          const tag = w.disabled ? " [disabled]" : "";
          return `- ${w.name}${tag} ⚠ invalid: ${w.error}`;
        }
        const tag = w.disabled ? " [disabled]" : "";
        return `- ${w.name}${tag}${w.description ? `: ${w.description}` : ""} (${summariseWorkflow(w)})`;
      })
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

// ── create_workflow ───────────────────────────────────────────────────────────

const sequenceStepSchema = z.union([
  z.string(),
  z.object({ workflow: z.string() }),
  z.object({ checkpoint: z.string() }),
]);

server.tool(
  "create_workflow",
  "Create or update a workflow definition in openflow.json. Supports all patterns (sequential, orchestrator, evaluator-optimizer, conditional, fanout, parallel, debate). Provide the fields for the chosen pattern; the entry is validated (shape, referenced agents, workflow references, and cycles) before it is persisted.",
  {
    name: z.string().describe("Workflow identifier (used in /workflow <name>)"),
    pattern: z
      .enum(["sequential", "orchestrator", "evaluator-optimizer", "conditional", "fanout", "parallel", "debate"])
      .optional()
      .describe("Coordination pattern (default: sequential)"),
    description: z.string().optional().describe("Short description shown by list_workflows"),
    force: z.boolean().optional().describe("Overwrite if workflow already exists (default: false)"),
    // sequential
    sequence: z.array(sequenceStepSchema).optional().describe("sequential: ordered steps — agent name, { workflow }, or { checkpoint }"),
    commanderMayAlsoUse: z.array(z.string()).optional().describe("sequential: agents the commander may deviate to (defaults to the sequence's agents)"),
    // orchestrator / fanout
    agents: z.array(z.string()).optional().describe("orchestrator/fanout: agent pool"),
    satisfactionCriteria: z.string().optional().describe("orchestrator: stop condition"),
    maxIterations: z.number().optional().describe("orchestrator/evaluator-optimizer: max iterations"),
    // evaluator-optimizer
    producer: z.string().optional().describe("evaluator-optimizer: producing agent"),
    evaluator: z.string().optional().describe("evaluator-optimizer: evaluating agent"),
    passCriteria: z.string().optional().describe("evaluator-optimizer: pass string (default: PASS)"),
    // conditional
    router: z.string().optional().describe("conditional: classifying agent"),
    routes: z.array(z.object({ condition: z.string(), workflow: z.string() })).optional().describe("conditional: condition → workflow routes"),
    default: z.string().optional().describe("conditional: fallback workflow"),
    // fanout
    picker: z.string().optional().describe("fanout: agent that selects the best result"),
    pickerPrompt: z.string().optional().describe("fanout: extra instruction for the picker"),
    // parallel
    subtasks: z.array(z.object({ agent: z.string(), prompt: z.string() })).optional().describe("parallel: independent { agent, prompt } subtasks"),
    merger: z.string().optional().describe("parallel: agent that consolidates results"),
    // debate
    proposer: z.string().optional().describe("debate: proposing agent"),
    critic: z.string().optional().describe("debate: critiquing agent"),
    judge: z.string().optional().describe("debate: judging agent"),
    rounds: z.number().optional().describe("debate: number of rounds (default: 2)"),
  },
  async (args) => {
    const result = await createWorkflow(args, client, WORK_DIR);
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

// ── enable_workflow ───────────────────────────────────────────────────────────

server.tool(
  "enable_workflow",
  "Enable a previously disabled workflow so it appears in list_workflows and can be run.",
  {
    name: z.string().describe("Workflow name as defined in openflow.json"),
  },
  async ({ name }) => {
    const result = await enableWorkflow(name, WORK_DIR);
    return { content: [{ type: "text", text: result }] };
  }
);

// ── disable_workflow ──────────────────────────────────────────────────────────

server.tool(
  "disable_workflow",
  "Disable a workflow so it is hidden from list_workflows and cannot be run. The definition is preserved and can be re-enabled later.",
  {
    name: z.string().describe("Workflow name as defined in openflow.json"),
  },
  async ({ name }) => {
    const result = await disableWorkflow(name, WORK_DIR);
    return { content: [{ type: "text", text: result }] };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
