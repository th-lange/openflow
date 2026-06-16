import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type OpencodeClient } from "@opencode-ai/sdk";
import { assertAgentExists } from "./agent-registry.js";

export type Workflow = {
  description?: string;
  sequence: string[];
  commanderMayAlsoUse: string[];
};

export type WorkflowRegistry = Record<string, Workflow>;

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
    for (const a of [...w.sequence, ...w.commanderMayAlsoUse]) {
      agentNames.add(a);
    }
  }
  for (const name of agentNames) {
    await assertAgentExists(client, name);
  }

  return registry;
}

function validateWorkflow(name: string, raw: unknown): Workflow {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Workflow "${name}" must be an object`);
  }
  const w = raw as Record<string, unknown>;

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
    description: typeof w["description"] === "string" ? w["description"] : undefined,
    sequence: w["sequence"] as string[],
    commanderMayAlsoUse: Array.isArray(mayAlsoUse) ? (mayAlsoUse as string[]) : [],
  };
}
