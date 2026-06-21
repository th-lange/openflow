import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { type OpencodeClient } from "@opencode-ai/sdk";
import { assertAgentExists } from "./agent-registry.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SequenceStep = string | { checkpoint: string } | { workflow: string };

/**
 * How much prior-step output a sequential workflow threads into each subsequent
 * step (#63). Threading every prior step's full output is O(n²) in tokens; this
 * lets a workflow trade context completeness for cost.
 * - `all`  — every prior step's output (default; current behavior)
 * - `last` — only the immediately preceding step's output
 * - `none` — no prior-step context (each step sees only the prompt)
 */
export type ContextScope = "all" | "last" | "none";

export const CONTEXT_SCOPES: readonly ContextScope[] = ["all", "last", "none"];
export const DEFAULT_CONTEXT_SCOPE: ContextScope = "all";

/**
 * Whether a sequential workflow threads compact structured handoffs between
 * steps (the default) instead of full step outputs (#64). When `true`, each
 * step's `\`\`\`handoff` block — or a truncated fallback — is threaded and shown
 * in the relay for intermediate steps; the final step is always shown in full.
 * Set `false` to restore full-output threading and relay (pre-#64 behaviour).
 */
export const DEFAULT_COMPACT_CONTEXT = true;

export type SequentialWorkflow = {
  pattern: "sequential";
  description?: string;
  disabled?: boolean;
  locked?: boolean;
  sequence: SequenceStep[];
  commanderMayAlsoUse: string[];
  contextScope?: ContextScope;
  compactContext?: boolean;
};

export type OrchestratorWorkflow = {
  pattern: "orchestrator";
  description?: string;
  disabled?: boolean;
  locked?: boolean;
  agents: string[];
  maxIterations: number;
  satisfactionCriteria: string;
};

export type EvaluatorOptimizerWorkflow = {
  pattern: "evaluator-optimizer";
  description?: string;
  disabled?: boolean;
  locked?: boolean;
  producer: string;
  evaluator: string;
  maxIterations: number;
  passCriteria: string;
};

export type ConditionalWorkflow = {
  pattern: "conditional";
  description?: string;
  disabled?: boolean;
  locked?: boolean;
  router: string;
  routes: Array<{ condition: string; workflow: string }>;
  default: string;
};

export type FanoutWorkflow = {
  pattern: "fanout";
  description?: string;
  disabled?: boolean;
  locked?: boolean;
  agents: string[];
  picker: string;
  pickerPrompt?: string;
};

export type ParallelWorkflow = {
  pattern: "parallel";
  description?: string;
  disabled?: boolean;
  locked?: boolean;
  subtasks: Array<{ agent: string; prompt: string }>;
  merger: string;
};

export type DebateWorkflow = {
  pattern: "debate";
  description?: string;
  disabled?: boolean;
  locked?: boolean;
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

// ── Engine settings (#45) ───────────────────────────────────────────────────────

/** Optional Langfuse tracing config (#67). API keys come from the environment. */
export type LangfuseSettings = {
  /** Master switch; tracing is off unless this is true. */
  enabled: boolean;
  /** Self-hosted Langfuse base URL; falls back to LANGFUSE_HOST then Langfuse cloud. */
  host?: string;
};

export type EngineSettings = {
  /** Per-agent delegation timeout in milliseconds. */
  agentTimeoutMs: number;
  /** Maximum number of agents dispatched concurrently (fan-out/parallel). */
  maxConcurrent: number;
  /** Langfuse tracing; undefined or { enabled: false } means no tracing. */
  langfuse?: LangfuseSettings;
};

export const DEFAULT_SETTINGS: EngineSettings = {
  agentTimeoutMs: 5 * 60 * 1000, // 5 minutes
  maxConcurrent: 5,
};

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Merge an optional `settings` block (as read from openflow.json) with
 * environment-variable overrides and the built-in defaults. Environment
 * variables take precedence over the file so operators can tune a running
 * install without editing config. Throws on malformed values so a bad setting
 * is caught at startup rather than silently ignored.
 */
export function mergeSettings(raw: unknown): EngineSettings {
  let { agentTimeoutMs, maxConcurrent } = DEFAULT_SETTINGS;
  let langfuse: LangfuseSettings | undefined;

  if (raw !== undefined) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error('openflow.json "settings" must be an object');
    }
    const s = raw as Record<string, unknown>;
    if (s["agentTimeoutMs"] !== undefined) {
      if (!isPositiveNumber(s["agentTimeoutMs"])) {
        throw new Error('"settings.agentTimeoutMs" must be a positive number (milliseconds)');
      }
      agentTimeoutMs = s["agentTimeoutMs"];
    }
    if (s["maxConcurrent"] !== undefined) {
      if (!isPositiveNumber(s["maxConcurrent"]) || !Number.isInteger(s["maxConcurrent"])) {
        throw new Error('"settings.maxConcurrent" must be a positive integer');
      }
      maxConcurrent = s["maxConcurrent"];
    }
    langfuse = parseLangfuseSettings(s["langfuse"]);
  }

  const envTimeout = process.env["OPENFLOW_AGENT_TIMEOUT_MS"];
  if (envTimeout) {
    const n = Number(envTimeout);
    if (!isPositiveNumber(n)) {
      throw new Error("OPENFLOW_AGENT_TIMEOUT_MS must be a positive number");
    }
    agentTimeoutMs = n;
  }
  const envConcurrent = process.env["OPENFLOW_MAX_CONCURRENT"];
  if (envConcurrent) {
    const n = Number(envConcurrent);
    if (!isPositiveNumber(n) || !Number.isInteger(n)) {
      throw new Error("OPENFLOW_MAX_CONCURRENT must be a positive integer");
    }
    maxConcurrent = n;
  }

  return { agentTimeoutMs, maxConcurrent, ...(langfuse ? { langfuse } : {}) };
}

function parseLangfuseSettings(raw: unknown): LangfuseSettings | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error('"settings.langfuse" must be an object');
  }
  const l = raw as Record<string, unknown>;
  if (l["enabled"] !== undefined && typeof l["enabled"] !== "boolean") {
    throw new Error('"settings.langfuse.enabled" must be a boolean');
  }
  if (l["host"] !== undefined && typeof l["host"] !== "string") {
    throw new Error('"settings.langfuse.host" must be a string');
  }
  return {
    enabled: l["enabled"] === true,
    ...(typeof l["host"] === "string" ? { host: l["host"] } : {}),
  };
}

/**
 * Resolve engine settings from `openflow.json` in `directory`, merged with
 * environment overrides and defaults. Missing file or missing `settings` block
 * yields the defaults.
 */
export async function resolveSettings(
  directory: string = process.cwd()
): Promise<EngineSettings> {
  const parsed = await readOpenflowFile(directory);
  const raw =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)["settings"]
      : undefined;
  return mergeSettings(raw);
}

// ── File read (single source — JSONC-tolerant) ──────────────────────────────────

/**
 * Read and parse `openflow.json` (JSON or JSONC) from `directory`.
 * Returns the parsed top-level value, or `undefined` when the file is absent.
 * Throws when the file exists but is not valid JSON/JSONC.
 *
 * This is the one read path shared by the validating loader and the runtime
 * lookup tools (see workflow-tools.ts) — #38.
 */
export async function readOpenflowFile(
  directory: string = process.cwd()
): Promise<unknown | undefined> {
  const path = resolve(directory, "openflow.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return undefined;
  }
  if (!raw.trim()) return {};
  const errors: ParseError[] = [];
  const parsed = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error("openflow.json is not valid JSON");
  }
  return parsed;
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loadWorkflows(
  client: OpencodeClient,
  directory: string = process.cwd()
): Promise<WorkflowRegistry> {
  const parsed = await readOpenflowFile(directory);
  if (parsed === undefined) return {};

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("openflow.json must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  mergeSettings(obj["settings"]); // validate the settings block at startup (#45)
  const rawWorkflows = obj["workflows"];
  if (!rawWorkflows || typeof rawWorkflows !== "object") return {};

  const registry: WorkflowRegistry = {};
  for (const [name, entry] of Object.entries(rawWorkflows as Record<string, unknown>)) {
    registry[name] = parseWorkflowEntry(name, entry);
  }

  // 1. Validate all referenced agents exist (skip disabled workflows)
  const agentNames = new Set<string>();
  for (const w of Object.values(registry)) {
    if (w.disabled) continue;
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

/**
 * Parse and validate a single workflow entry into a typed `Workflow`.
 * Throws on malformed input. This is the canonical per-entry parser shared by
 * the loader and the runtime lookup tools (#38).
 */
export function parseWorkflowEntry(name: string, raw: unknown): Workflow {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Workflow "${name}" must be an object`);
  }
  const w = raw as Record<string, unknown>;
  const pattern = w["pattern"] ?? "sequential";
  const disabled = w["disabled"] === true ? true : undefined;
  const locked = w["locked"] === true ? true : undefined;

  let result: Workflow;
  if (pattern === "sequential") result = validateSequentialWorkflow(name, w);
  else if (pattern === "orchestrator") result = validateOrchestratorWorkflow(name, w);
  else if (pattern === "evaluator-optimizer") result = validateEvaluatorOptimizerWorkflow(name, w);
  else if (pattern === "conditional") result = validateConditionalWorkflow(name, w);
  else if (pattern === "fanout") result = validateFanoutWorkflow(name, w);
  else if (pattern === "parallel") result = validateParallelWorkflow(name, w);
  else if (pattern === "debate") result = validateDebateWorkflow(name, w);
  else throw new Error(`Workflow "${name}": unknown pattern "${pattern}"`);

  if (disabled || locked) {
    return { ...result, ...(disabled ? { disabled } : {}), ...(locked ? { locked } : {}) } as Workflow;
  }
  return result;
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

  const contextScope = w["contextScope"];
  if (contextScope !== undefined && !CONTEXT_SCOPES.includes(contextScope as ContextScope)) {
    throw new Error(
      `Workflow "${name}": "contextScope" must be one of ${CONTEXT_SCOPES.join(", ")}`
    );
  }

  const compactContext = w["compactContext"];
  if (compactContext !== undefined && typeof compactContext !== "boolean") {
    throw new Error(`Workflow "${name}": "compactContext" must be a boolean`);
  }

  return {
    pattern: "sequential",
    description: typeof w["description"] === "string" ? w["description"] : undefined,
    sequence,
    commanderMayAlsoUse: Array.isArray(mayAlsoUse) ? (mayAlsoUse as string[]) : [],
    ...(contextScope !== undefined ? { contextScope: contextScope as ContextScope } : {}),
    ...(compactContext !== undefined ? { compactContext } : {}),
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
