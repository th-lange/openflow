import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type OpencodeClient } from "@opencode-ai/sdk";
import { assertAgentExists } from "./agent-registry.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SequentialWorkflow = {
  pattern: "sequential";
  description?: string;
  sequence: string[];
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

export type Workflow =
  | SequentialWorkflow
  | OrchestratorWorkflow
  | EvaluatorOptimizerWorkflow
  | ConditionalWorkflow;

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

  // Validate all referenced agents exist
  const agentNames = new Set<string>();
  for (const w of Object.values(registry)) {
    if (w.pattern === "sequential") {
      for (const a of [...w.sequence, ...w.commanderMayAlsoUse]) agentNames.add(a);
    } else if (w.pattern === "orchestrator") {
      for (const a of w.agents) agentNames.add(a);
    } else if (w.pattern === "evaluator-optimizer") {
      agentNames.add(w.producer);
      agentNames.add(w.evaluator);
    } else if (w.pattern === "conditional") {
      agentNames.add(w.router);
    }
  }
  for (const name of agentNames) {
    await assertAgentExists(client, name);
  }

  // Validate conditional workflow references
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

  return registry;
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
  throw new Error(`Workflow "${name}": unknown pattern "${pattern}"`);
}

function validateSequentialWorkflow(name: string, w: Record<string, unknown>): SequentialWorkflow {
  if (!Array.isArray(w["sequence"]) || w["sequence"].length === 0) {
    throw new Error(`Workflow "${name}" must have a non-empty "sequence" array`);
  }
  for (const item of w["sequence"]) {
    if (typeof item !== "string") {
      throw new Error(`Workflow "${name}": sequence items must be strings`);
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
    sequence: w["sequence"] as string[],
    commanderMayAlsoUse: Array.isArray(mayAlsoUse) ? (mayAlsoUse as string[]) : [],
  };
}

function validateOrchestratorWorkflow(name: string, w: Record<string, unknown>): OrchestratorWorkflow {
  if (!Array.isArray(w["agents"]) || w["agents"].length === 0) {
    throw new Error(`Orchestrator workflow "${name}" must have a non-empty "agents" array`);
  }
  for (const item of w["agents"]) {
    if (typeof item !== "string") {
      throw new Error(`Workflow "${name}": agents items must be strings`);
    }
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
