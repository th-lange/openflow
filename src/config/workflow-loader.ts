import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type OpencodeClient } from "@opencode-ai/sdk";
import { assertAgentExists } from "./agent-registry.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SequenceStep = string | { checkpoint: string } | { workflow: string };

export type SequentialWorkflow = {
  pattern: "sequential";
  description?: string;
  sequence: SequenceStep[];
  commanderMayAlsoUse: string[];
};

export type OrchestratorWorkflow = {
  pattern: "orchestrator";
  description?: string;
  agents: string[];
  maxIterations: number;
  satisfactionCriteria: string;
};

export type EvaluatorOptimizerWorkflow = {
  pattern: "evaluator-optimizer";
  description?: string;
  producer: string;
  evaluator: string;
  maxIterations: number;
  passCriteria: string;
};

export type ConditionalWorkflow = {
  pattern: "conditional";
  description?: string;
  router: string;
  routes: Array<{ condition: string; workflow: string }>;
  default: string;
};

export type FanoutWorkflow = {
  pattern: "fanout";
  description?: string;
  agents: string[];
  picker: string;
  pickerPrompt?: string;
};

export type ParallelWorkflow = {
  pattern: "parallel";
  description?: string;
  subtasks: Array<{ agent: string; prompt: string }>;
  merger: string;
};

export type DebateWorkflow = {
  pattern: "debate";
  description?: string;
  proposer: string;
  critic: string;
  rounds: number;
  judge: string;
};

export type Workflow =
  | SequentialWorkflow
  | OrchestratorWorkflow
  | EvaluatorOptimizerWorkflow
  | ConditionalWorkflow
  | FanoutWorkflow
  | ParallelWorkflow
  | DebateWorkflow;

export type WorkflowRegistry = Record<string, Workflow>;

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loadWorkflows(
  client: OpencodeClient,
  directory: string = process.cwd()
): Promise<WorkflowRegistry> {
  const path = resolve(directory, "openflow.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`openflow.json is not valid JSON: ${(e as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("openflow.json must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  const rawWorkflows = obj["workflows"];
  if (!rawWorkflows || typeof rawWorkflows !== "object") return {};

  const registry: WorkflowRegistry = {};
  for (const [name, entry] of Object.entries(rawWorkflows as Record<string, unknown>)) {
    registry[name] = validateWorkflow(name, entry);
  }

  // 1. Validate all referenced agents exist
  const agentNames = new Set<string>();
  for (const w of Object.values(registry)) {
    switch (w.pattern) {
      case "sequential":
        for (const step of w.sequence) {
          if (typeof step === "string") agentNames.add(step);
        }
        for (const a of w.commanderMayAlsoUse) agentNames.add(a);
        break;
      case "orchestrator":
        for (const a of w.agents) agentNames.add(a);
        break;
      case "evaluator-optimizer":
        agentNames.add(w.producer);
        agentNames.add(w.evaluator);
        break;
      case "conditional":
        agentNames.add(w.router);
        break;
      case "fanout":
        for (const a of w.agents) agentNames.add(a);
        agentNames.add(w.picker);
        break;
      case "parallel":
        for (const s of w.subtasks) agentNames.add(s.agent);
        agentNames.add(w.merger);
        break;
      case "debate":
        agentNames.add(w.proposer);
        agentNames.add(w.critic);
        agentNames.add(w.judge);
        break;
    }
  }
  for (const name of agentNames) {
    await assertAgentExists(client, name);
  }

  // 2. Validate workflow references in conditional routes
  for (const [name, w] of Object.entries(registry)) {
    if (w.pattern !== "conditional") continue;
    for (const route of w.routes) {
      if (!registry[route.workflow]) {
        throw new Error(
          `Conditional workflow "${name}": route "${route.condition}" references unknown workflow "${route.workflow}"`
        );
      }
    }
    if (!registry[w.default]) {
      throw new Error(
        `Conditional workflow "${name}": default references unknown workflow "${w.default}"`
      );
    }
  }

  // 3. Validate workflow references in sequential sequences
  for (const [name, w] of Object.entries(registry)) {
    if (w.pattern !== "sequential") continue;
    for (const step of w.sequence) {
      if (typeof step === "object" && "workflow" in step) {
        if (!registry[step.workflow]) {
          throw new Error(
            `Sequential workflow "${name}": step references unknown workflow "${step.workflow}"`
          );
        }
      }
    }
  }

  // 4. Checkpoint constraint: checkpoint workflows cannot be referenced by other workflows
  validateNoCheckpointReferences(registry);

  // 5. Cycle detection across all workflow references
  detectCycles(registry);

  return registry;
}

// ── Reference graph helpers ───────────────────────────────────────────────────

function workflowRefs(w: Workflow): string[] {
  if (w.pattern === "sequential") {
    return w.sequence
      .filter((s): s is { workflow: string } => typeof s === "object" && "workflow" in s)
      .map((s) => s.workflow);
  }
  if (w.pattern === "conditional") {
    return [...w.routes.map((r) => r.workflow), w.default];
  }
  return [];
}

function validateNoCheckpointReferences(registry: WorkflowRegistry): void {
  const checkpointWorkflows = new Set(
    Object.entries(registry)
      .filter(
        ([, w]) =>
          w.pattern === "sequential" &&
          w.sequence.some((s) => typeof s === "object" && "checkpoint" in s)
      )
      .map(([name]) => name)
  );
  if (checkpointWorkflows.size === 0) return;

  for (const [name, w] of Object.entries(registry)) {
    for (const ref of workflowRefs(w)) {
      if (checkpointWorkflows.has(ref)) {
        throw new Error(
          `Workflow "${name}" references "${ref}" which contains checkpoint steps. ` +
            `Checkpoint workflows must be top-level (not referenced by other workflows). ` +
            `Hoist the checkpoint to the hosting sequence or inline the steps from "${ref}".`
        );
      }
    }
  }
}

function detectCycles(registry: WorkflowRegistry): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(name: string, path: string[]): void {
    if (visiting.has(name)) {
      const from = path.indexOf(name);
      throw new Error(
        `Workflow cycle detected: ${[...path.slice(from), name].join(" → ")}`
      );
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const ref of workflowRefs(registry[name] ?? ({} as Workflow))) {
      dfs(ref, [...path, name]);
    }
    visiting.delete(name);
    visited.add(name);
  }

  for (const name of Object.keys(registry)) {
    dfs(name, []);
  }
}

// ── Validators ────────────────────────────────────────────────────────────────

function validateWorkflow(name: string, raw: unknown): Workflow {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Workflow "${name}" must be an object`);
  }
  const w = raw as Record<string, unknown>;
  const pattern = w["pattern"] ?? "sequential";

  if (pattern === "sequential") return validateSequentialWorkflow(name, w);
  if (pattern === "orchestrator") return validateOrchestratorWorkflow(name, w);
  if (pattern === "evaluator-optimizer") return validateEvaluatorOptimizerWorkflow(name, w);
  if (pattern === "conditional") return validateConditionalWorkflow(name, w);
  if (pattern === "fanout") return validateFanoutWorkflow(name, w);
  if (pattern === "parallel") return validateParallelWorkflow(name, w);
  if (pattern === "debate") return validateDebateWorkflow(name, w);
  throw new Error(`Workflow "${name}": unknown pattern "${pattern}"`);
}

function validateSequentialWorkflow(name: string, w: Record<string, unknown>): SequentialWorkflow {
  if (!Array.isArray(w["sequence"]) || w["sequence"].length === 0) {
    throw new Error(`Workflow "${name}" must have a non-empty "sequence" array`);
  }
  const sequence: SequenceStep[] = [];
  for (const item of w["sequence"]) {
    if (typeof item === "string") {
      sequence.push(item);
    } else if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      if (typeof obj["checkpoint"] === "string") {
        sequence.push({ checkpoint: obj["checkpoint"] });
      } else if (typeof obj["workflow"] === "string") {
        sequence.push({ workflow: obj["workflow"] });
      } else {
        throw new Error(
          `Workflow "${name}": sequence items must be agent name strings, ` +
            `{ "checkpoint": "message" } objects, or { "workflow": "name" } references`
        );
      }
    } else {
      throw new Error(
        `Workflow "${name}": sequence items must be agent name strings, ` +
          `{ "checkpoint": "message" } objects, or { "workflow": "name" } references`
      );
    }
  }

  const mayAlsoUse = w["commanderMayAlsoUse"];
  if (mayAlsoUse !== undefined && !Array.isArray(mayAlsoUse)) {
    throw new Error(`Workflow "${name}": "commanderMayAlsoUse" must be an array`);
  }
  if (Array.isArray(mayAlsoUse)) {
    for (const item of mayAlsoUse) {
      if (typeof item !== "string") {
        throw new Error(`Workflow "${name}": commanderMayAlsoUse items must be strings`);
      }
    }
  }

  return {
    pattern: "sequential",
    description: typeof w["description"] === "string" ? w["description"] : undefined,
    sequence,
    commanderMayAlsoUse: Array.isArray(mayAlsoUse) ? (mayAlsoUse as string[]) : [],
  };
}

function validateOrchestratorWorkflow(name: string, w: Record<string, unknown>): OrchestratorWorkflow {
  if (!Array.isArray(w["agents"]) || w["agents"].length === 0) {
    throw new Error(`Orchestrator workflow "${name}" must have a non-empty "agents" array`);
  }
  for (const item of w["agents"]) {
    if (typeof item !== "string") throw new Error(`Workflow "${name}": agents items must be strings`);
  }
  const maxIterations = w["maxIterations"];
  if (maxIterations !== undefined && (typeof maxIterations !== "number" || maxIterations < 1)) {
    throw new Error(`Workflow "${name}": "maxIterations" must be a positive number`);
  }
  const satisfactionCriteria = w["satisfactionCriteria"];
  if (typeof satisfactionCriteria !== "string" || !satisfactionCriteria.trim()) {
    throw new Error(`Orchestrator workflow "${name}" must have a non-empty "satisfactionCriteria" string`);
  }
  return {
    pattern: "orchestrator",
    description: typeof w["description"] === "string" ? w["description"] : undefined,
    agents: w["agents"] as string[],
    maxIterations: typeof maxIterations === "number" ? maxIterations : 6,
    satisfactionCriteria,
  };
}

function validateEvaluatorOptimizerWorkflow(
  name: string,
  w: Record<string, unknown>
): EvaluatorOptimizerWorkflow {
  if (typeof w["producer"] !== "string" || !w["producer"].trim()) {
    throw new Error(`Evaluator-optimizer workflow "${name}" must have a non-empty "producer" string`);
  }
  if (typeof w["evaluator"] !== "string" || !w["evaluator"].trim()) {
    throw new Error(`Evaluator-optimizer workflow "${name}" must have a non-empty "evaluator" string`);
  }
  const maxIterations = w["maxIterations"];
  if (maxIterations !== undefined && (typeof maxIterations !== "number" || maxIterations < 1)) {
    throw new Error(`Workflow "${name}": "maxIterations" must be a positive number`);
  }
  const passCriteria = w["passCriteria"];
  if (passCriteria !== undefined && (typeof passCriteria !== "string" || !passCriteria.trim())) {
    throw new Error(`Workflow "${name}": "passCriteria" must be a non-empty string`);
  }
  return {
    pattern: "evaluator-optimizer",
    description: typeof w["description"] === "string" ? w["description"] : undefined,
    producer: w["producer"] as string,
    evaluator: w["evaluator"] as string,
    maxIterations: typeof maxIterations === "number" ? maxIterations : 3,
    passCriteria: typeof passCriteria === "string" ? passCriteria : "PASS",
  };
}

function validateConditionalWorkflow(name: string, w: Record<string, unknown>): ConditionalWorkflow {
  if (typeof w["router"] !== "string" || !w["router"].trim()) {
    throw new Error(`Conditional workflow "${name}" must have a non-empty "router" string`);
  }
  if (!Array.isArray(w["routes"]) || w["routes"].length === 0) {
    throw new Error(`Conditional workflow "${name}" must have a non-empty "routes" array`);
  }
  for (const route of w["routes"]) {
    if (typeof route !== "object" || route === null) {
      throw new Error(`Conditional workflow "${name}": each route must be an object`);
    }
    const r = route as Record<string, unknown>;
    if (typeof r["condition"] !== "string" || !r["condition"].trim()) {
      throw new Error(`Conditional workflow "${name}": each route must have a non-empty "condition" string`);
    }
    if (typeof r["workflow"] !== "string" || !r["workflow"].trim()) {
      throw new Error(`Conditional workflow "${name}": each route must have a non-empty "workflow" string`);
    }
  }
  if (typeof w["default"] !== "string" || !w["default"].trim()) {
    throw new Error(`Conditional workflow "${name}" must have a non-empty "default" workflow name`);
  }
  return {
    pattern: "conditional",
    description: typeof w["description"] === "string" ? w["description"] : undefined,
    router: w["router"] as string,
    routes: (w["routes"] as Array<Record<string, unknown>>).map((r) => ({
      condition: r["condition"] as string,
      workflow: r["workflow"] as string,
    })),
    default: w["default"] as string,
  };
}

function validateFanoutWorkflow(name: string, w: Record<string, unknown>): FanoutWorkflow {
  if (!Array.isArray(w["agents"]) || w["agents"].length === 0) {
    throw new Error(`Fan-out workflow "${name}" must have a non-empty "agents" array`);
  }
  for (const item of w["agents"]) {
    if (typeof item !== "string") throw new Error(`Workflow "${name}": agents items must be strings`);
  }
  if (typeof w["picker"] !== "string" || !w["picker"].trim()) {
    throw new Error(`Fan-out workflow "${name}" must have a non-empty "picker" string`);
  }
  const pickerPrompt = w["pickerPrompt"];
  if (pickerPrompt !== undefined && typeof pickerPrompt !== "string") {
    throw new Error(`Workflow "${name}": "pickerPrompt" must be a string`);
  }
  return {
    pattern: "fanout",
    description: typeof w["description"] === "string" ? w["description"] : undefined,
    agents: w["agents"] as string[],
    picker: w["picker"] as string,
    pickerPrompt: typeof pickerPrompt === "string" ? pickerPrompt : undefined,
  };
}

function validateParallelWorkflow(name: string, w: Record<string, unknown>): ParallelWorkflow {
  if (!Array.isArray(w["subtasks"]) || w["subtasks"].length === 0) {
    throw new Error(`Parallel workflow "${name}" must have a non-empty "subtasks" array`);
  }
  const subtasks: Array<{ agent: string; prompt: string }> = [];
  for (const subtask of w["subtasks"]) {
    if (typeof subtask !== "object" || subtask === null) {
      throw new Error(`Workflow "${name}": each subtask must be an object`);
    }
    const s = subtask as Record<string, unknown>;
    if (typeof s["agent"] !== "string" || !s["agent"].trim()) {
      throw new Error(`Workflow "${name}": each subtask must have a non-empty "agent" string`);
    }
    if (typeof s["prompt"] !== "string" || !s["prompt"].trim()) {
      throw new Error(`Workflow "${name}": each subtask must have a non-empty "prompt" string`);
    }
    subtasks.push({ agent: s["agent"] as string, prompt: s["prompt"] as string });
  }
  if (typeof w["merger"] !== "string" || !w["merger"].trim()) {
    throw new Error(`Parallel workflow "${name}" must have a non-empty "merger" string`);
  }
  return {
    pattern: "parallel",
    description: typeof w["description"] === "string" ? w["description"] : undefined,
    subtasks,
    merger: w["merger"] as string,
  };
}

function validateDebateWorkflow(name: string, w: Record<string, unknown>): DebateWorkflow {
  for (const field of ["proposer", "critic", "judge"] as const) {
    if (typeof w[field] !== "string" || !(w[field] as string).trim()) {
      throw new Error(`Debate workflow "${name}" must have a non-empty "${field}" string`);
    }
  }
  const rounds = w["rounds"];
  if (rounds !== undefined && (typeof rounds !== "number" || rounds < 1)) {
    throw new Error(`Workflow "${name}": "rounds" must be a positive number`);
  }
  return {
    pattern: "debate",
    description: typeof w["description"] === "string" ? w["description"] : undefined,
    proposer: w["proposer"] as string,
    critic: w["critic"] as string,
    rounds: typeof rounds === "number" ? rounds : 2,
    judge: w["judge"] as string,
  };
}
