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

export type Workflow = SequentialWorkflow | OrchestratorWorkflow;
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

  for (const [name, raw] of Object.entries(rawWorkflows as Record<string, unknown>)) {
    const w = validateWorkflow(name, raw);
    registry[name] = w;
  }

  // Cross-validate all referenced agents actually exist
  const agentNames = new Set<string>();
  for (const w of Object.values(registry)) {
    if (w.pattern === "sequential") {
      for (const a of [...w.sequence, ...w.commanderMayAlsoUse]) agentNames.add(a);
    } else {
      for (const a of w.agents) agentNames.add(a);
    }
  }
  for (const name of agentNames) {
    await assertAgentExists(client, name);
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

  if (pattern === "orchestrator") return validateOrchestratorWorkflow(name, w);
  if (pattern === "sequential") return validateSequentialWorkflow(name, w);
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
