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
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
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

  if (pattern === "evaluator-optimizer") {
    return {
      name,
      pattern: "evaluator-optimizer",
      description,
      producer: typeof w["producer"] === "string" ? w["producer"] : "",
      evaluator: typeof w["evaluator"] === "string" ? w["evaluator"] : "",
      maxIterations: typeof w["maxIterations"] === "number" ? w["maxIterations"] : 3,
      passCriteria: typeof w["passCriteria"] === "string" ? w["passCriteria"] : "PASS",
    };
  }

  if (pattern === "conditional") {
    const routes = Array.isArray(w["routes"])
      ? (w["routes"] as Array<Record<string, unknown>>).map((r) => ({
          condition: typeof r["condition"] === "string" ? r["condition"] : "",
          workflow: typeof r["workflow"] === "string" ? r["workflow"] : "",
        }))
      : [];
    return {
      name,
      pattern: "conditional",
      description,
      router: typeof w["router"] === "string" ? w["router"] : "",
      routes,
      default: typeof w["default"] === "string" ? w["default"] : "",
    };
  }

  // Default: sequential
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
  switch (w.pattern) {
    case "sequential":
      return w.sequence.join(" → ");
    case "orchestrator":
      return `orchestrator [${w.agents.join(", ")}] max=${w.maxIterations}`;
    case "evaluator-optimizer":
      return `${w.producer} ⇄ ${w.evaluator} (max ${w.maxIterations} iter)`;
    case "conditional":
      return `${w.router} → [${w.routes.map((r) => r.condition).join(" | ")}]`;
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
