import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type WorkflowInfo = {
  name: string;
  description?: string;
  sequence: string[];
  commanderMayAlsoUse: string[];
};

async function readOpenflowJson(directory: string): Promise<Record<string, unknown>> {
  const path = resolve(directory, "openflow.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    throw new Error("openflow.json is not valid JSON");
  }
}

export async function getWorkflow(
  name: string,
  directory: string = process.cwd()
): Promise<WorkflowInfo> {
  const config = await readOpenflowJson(directory);
  const workflows = config["workflows"];
  if (!workflows || typeof workflows !== "object") {
    throw new Error("No workflows defined in openflow.json");
  }
  const raw = (workflows as Record<string, unknown>)[name];
  if (!raw || typeof raw !== "object") {
    const available = Object.keys(workflows as object).join(", ");
    throw new Error(`Workflow "${name}" not found. Available: ${available || "(none)"}`);
  }
  const w = raw as Record<string, unknown>;
  const sequence = Array.isArray(w["sequence"]) ? (w["sequence"] as string[]) : [];
  const mayAlsoUse = Array.isArray(w["commanderMayAlsoUse"])
    ? (w["commanderMayAlsoUse"] as string[])
    : [];
  return {
    name,
    description: typeof w["description"] === "string" ? w["description"] : undefined,
    sequence,
    commanderMayAlsoUse: mayAlsoUse,
  };
}

export async function listWorkflows(
  directory: string = process.cwd()
): Promise<WorkflowInfo[]> {
  const config = await readOpenflowJson(directory);
  const workflows = config["workflows"];
  if (!workflows || typeof workflows !== "object") return [];
  return Object.entries(workflows as Record<string, unknown>).map(([name, raw]) => {
    if (!raw || typeof raw !== "object") return { name, sequence: [], commanderMayAlsoUse: [] };
    const w = raw as Record<string, unknown>;
    return {
      name,
      description: typeof w["description"] === "string" ? w["description"] : undefined,
      sequence: Array.isArray(w["sequence"]) ? (w["sequence"] as string[]) : [],
      commanderMayAlsoUse: Array.isArray(w["commanderMayAlsoUse"])
        ? (w["commanderMayAlsoUse"] as string[])
        : [],
    };
  });
}
