import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import type { Workflow, SequenceStep } from "../config/workflow-loader.js";

export type WorkflowInfo = Workflow & { name: string };

async function readOpenflowJson(directory: string): Promise<Record<string, unknown>> {
  const path = resolve(directory, "openflow.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return {};
  }
  if (!raw.trim()) return {};
  const errors: ParseError[] = [];
  const parsed = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error("openflow.json is not valid JSON");
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function parseSequenceStep(item: unknown): SequenceStep {
  if (typeof item === "string") return item;
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>;
    if (typeof obj["checkpoint"] === "string") return { checkpoint: obj["checkpoint"] };
    if (typeof obj["workflow"] === "string") return { workflow: obj["workflow"] };
  }
  return String(item);
}

function parseWorkflowEntry(name: string, raw: unknown): WorkflowInfo {
  if (!raw || typeof raw !== "object") {
    return { name, pattern: "sequential", sequence: [], commanderMayAlsoUse: [] };
  }
  const w = raw as Record<string, unknown>;
  const pattern = (w["pattern"] as string) ?? "sequential";
  const description = typeof w["description"] === "string" ? w["description"] : undefined;
  const disabled = w["disabled"] === true ? true : undefined;

  switch (pattern) {
    case "orchestrator":
      return {
        name, pattern: "orchestrator", description, disabled,
        agents: Array.isArray(w["agents"]) ? (w["agents"] as string[]) : [],
        maxIterations: typeof w["maxIterations"] === "number" ? w["maxIterations"] : 6,
        satisfactionCriteria: typeof w["satisfactionCriteria"] === "string" ? w["satisfactionCriteria"] : "",
      };

    case "evaluator-optimizer":
      return {
        name, pattern: "evaluator-optimizer", description, disabled,
        producer: typeof w["producer"] === "string" ? w["producer"] : "",
        evaluator: typeof w["evaluator"] === "string" ? w["evaluator"] : "",
        maxIterations: typeof w["maxIterations"] === "number" ? w["maxIterations"] : 3,
        passCriteria: typeof w["passCriteria"] === "string" ? w["passCriteria"] : "PASS",
      };

    case "conditional": {
      const routes = Array.isArray(w["routes"])
        ? (w["routes"] as Array<Record<string, unknown>>).map((r) => ({
            condition: typeof r["condition"] === "string" ? r["condition"] : "",
            workflow: typeof r["workflow"] === "string" ? r["workflow"] : "",
          }))
        : [];
      return {
        name, pattern: "conditional", description, disabled,
        router: typeof w["router"] === "string" ? w["router"] : "",
        routes,
        default: typeof w["default"] === "string" ? w["default"] : "",
      };
    }

    case "fanout":
      return {
        name, pattern: "fanout", description, disabled,
        agents: Array.isArray(w["agents"]) ? (w["agents"] as string[]) : [],
        picker: typeof w["picker"] === "string" ? w["picker"] : "",
        pickerPrompt: typeof w["pickerPrompt"] === "string" ? w["pickerPrompt"] : undefined,
      };

    case "parallel": {
      const subtasks = Array.isArray(w["subtasks"])
        ? (w["subtasks"] as Array<Record<string, unknown>>).map((s) => ({
            agent: typeof s["agent"] === "string" ? s["agent"] : "",
            prompt: typeof s["prompt"] === "string" ? s["prompt"] : "",
          }))
        : [];
      return {
        name, pattern: "parallel", description, disabled,
        subtasks,
        merger: typeof w["merger"] === "string" ? w["merger"] : "",
      };
    }

    case "debate":
      return {
        name, pattern: "debate", description, disabled,
        proposer: typeof w["proposer"] === "string" ? w["proposer"] : "",
        critic: typeof w["critic"] === "string" ? w["critic"] : "",
        rounds: typeof w["rounds"] === "number" ? w["rounds"] : 2,
        judge: typeof w["judge"] === "string" ? w["judge"] : "",
      };

    default:
      return {
        name, pattern: "sequential", description, disabled,
        sequence: Array.isArray(w["sequence"])
          ? (w["sequence"] as unknown[]).map(parseSequenceStep)
          : [],
        commanderMayAlsoUse: Array.isArray(w["commanderMayAlsoUse"])
          ? (w["commanderMayAlsoUse"] as string[])
          : [],
      };
  }
}

export function summariseWorkflow(w: WorkflowInfo): string {
  switch (w.pattern) {
    case "sequential":
      return w.sequence
        .map((s) =>
          typeof s === "string"
            ? s
            : "workflow" in s
            ? `[${s.workflow}]`
            : "[checkpoint]"
        )
        .join(" → ");
    case "orchestrator":
      return `orchestrator [${w.agents.join(", ")}] max=${w.maxIterations}`;
    case "evaluator-optimizer":
      return `${w.producer} ⇄ ${w.evaluator} (max ${w.maxIterations} iter)`;
    case "conditional":
      return `${w.router} → [${w.routes.map((r) => r.condition).join(" | ")}]`;
    case "fanout":
      return `[${w.agents.join(", ")}] → ${w.picker}`;
    case "parallel":
      return `${w.subtasks.length} subtasks → ${w.merger}`;
    case "debate":
      return `${w.proposer} vs ${w.critic} (${w.rounds} rounds) → ${w.judge}`;
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
    const available = Object.keys(workflows as object)
      .filter((k) => (workflows as Record<string, unknown>)[k] &&
        (workflows as Record<string, Record<string, unknown>>)[k]["disabled"] !== true)
      .join(", ");
    throw new Error(`Workflow "${name}" not found. Available: ${available || "(none)"}`);
  }
  const parsed = parseWorkflowEntry(name, raw);
  if (parsed.disabled) {
    throw new Error(`Workflow "${name}" is disabled`);
  }
  return parsed;
}

export async function listWorkflows(
  directory: string = process.cwd(),
  includeDisabled = false
): Promise<WorkflowInfo[]> {
  const config = await readOpenflowJson(directory);
  const workflows = config["workflows"];
  if (!workflows || typeof workflows !== "object") return [];
  const all = Object.entries(workflows as Record<string, unknown>).map(([name, raw]) =>
    parseWorkflowEntry(name, raw)
  );
  return includeDisabled ? all : all.filter((w) => !w.disabled);
}
