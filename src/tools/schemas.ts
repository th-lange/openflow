import { z } from "zod";

// Shared Zod arg shapes for the openflow tools. Each export is a ZodRawShape
// consumed directly by the plugin's `tool({ args })` (src/plugin.ts), kept in
// one place so tool interfaces stay consistent.

export const sequenceStepSchema = z.union([
  z.string(),
  z.object({ workflow: z.string() }),
  z.object({ checkpoint: z.string() }),
]);

export const createWorkflowArgs = {
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
  contextScope: z.enum(["all", "last", "none"]).optional().describe("sequential: how much prior-step output to thread into each step — all (default), last (previous step only), or none"),
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
};

export const createAgentArgs = {
  name: z.string().describe("Agent identifier"),
  prompt: z.string().describe("System prompt for the agent"),
  description: z.string().optional().describe("Short description of the agent's role"),
  mode: z.enum(["subagent", "primary", "all"]).optional().describe("Agent mode (default: subagent)"),
  model: z.string().optional().describe("Model to use, e.g. anthropic/claude-sonnet-4-5"),
  allowEdit: z.boolean().optional().describe("Allow file edits (default: false)"),
  allowBash: z.boolean().optional().describe("Allow bash commands (default: false)"),
  force: z.boolean().optional().describe("Overwrite if agent already exists (default: false)"),
};
