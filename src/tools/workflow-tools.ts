import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Workflow } from "../config/workflow-loader.js";

export type WorkflowInfo = Workflow & { name: string };

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

function parseWorkflowEntry(name: string, raw: unknown): WorkflowInfo {
  if (!raw || typeof raw !== "object") {
    return { name, pattern: "sequential", sequence: [], commanderMayAlsoUse: [] };
  }
  const w = raw as Record<string, unknown>;
  const pattern = (w["pattern"] as string) ?? "sequential";
  const description = typeof w["description"] === "string" ? w["description"] : undefined;

  if (pattern === "orchestrator") {
    return {
      name,
      pattern: "orchestrator",
      description,
      agents: Array.isArray(w["agents"]) ? (w["agents"] as string[]) : [],
      maxIterations: typeof w["maxIterations"] === "number" ? w["maxIterations"] : 6,
      satisfactionCriteria:
        typeof w["satisfactionCriteria"] === "string" ? w["satisfactionCriteria"] : "",
    };
  }

  return {
    name,
    pattern: "sequential",
    description,
    sequence: Array.isArray(w["sequence"]) ? (w["sequence"] as string[]) : [],
    commanderMayAlsoUse: Array.isArray(w["commanderMayAlsoUse"])
      ? (w["commanderMayAlsoUse"] as string[])
      : [],
  };
}

export function summariseWorkflow(w: WorkflowInfo): string {
  if (w.pattern === "orchestrator") {
    return `orchestrator [${w.agents.join(", ")}] max=${w.maxIterations}`;
  }
  return w.sequence.join(" → ");
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
  return parseWorkflowEntry(name, raw);
}

export async function listWorkflows(
  directory: string = process.cwd()
): Promise<WorkflowInfo[]> {
  const config = await readOpenflowJson(directory);
  const workflows = config["workflows"];
  if (!workflows || typeof workflows !== "object") return [];
  return Object.entries(workflows as Record<string, unknown>).map(([name, raw]) =>
    parseWorkflowEntry(name, raw)
  );
}
