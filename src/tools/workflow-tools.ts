import {
  parseWorkflowEntry,
  readOpenflowFile,
  type Workflow,
} from "../config/workflow-loader.js";

export type WorkflowInfo = Workflow & { name: string };

/** An entry that failed to parse — surfaced in listings so it isn't silently hidden. */
export type InvalidWorkflowInfo = {
  name: string;
  invalid: true;
  error: string;
  disabled?: boolean;
};

async function readWorkflowsMap(directory: string): Promise<Record<string, unknown>> {
  const parsed = await readOpenflowFile(directory);
  if (parsed === undefined || typeof parsed !== "object" || parsed === null) return {};
  const workflows = (parsed as Record<string, unknown>)["workflows"];
  return workflows && typeof workflows === "object" ? (workflows as Record<string, unknown>) : {};
}

export function summariseWorkflow(w: WorkflowInfo): string {
  switch (w.pattern) {
    case "sequential":
      return w.sequence
        .map((s) =>
          typeof s === "string" ? s : "workflow" in s ? `[${s.workflow}]` : "[checkpoint]"
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

/**
 * Look up and parse a single workflow by name. Uses the same parser as the
 * startup validator (#38), so a workflow that `getWorkflow` accepts is one the
 * loader would too. Throws on unknown, disabled, or malformed workflows.
 */
export async function getWorkflow(
  name: string,
  directory: string = process.cwd()
): Promise<WorkflowInfo> {
  const workflows = await readWorkflowsMap(directory);
  const raw = workflows[name];
  if (!raw || typeof raw !== "object") {
    const available = Object.keys(workflows)
      .filter((k) => (workflows[k] as Record<string, unknown>)?.["disabled"] !== true)
      .join(", ");
    throw new Error(`Workflow "${name}" not found. Available: ${available || "(none)"}`);
  }
  const parsed = parseWorkflowEntry(name, raw);
  if (parsed.disabled) {
    throw new Error(`Workflow "${name}" is disabled`);
  }
  return { ...parsed, name };
}

/**
 * List workflows. Parses each entry with the canonical parser; an entry that
 * fails to parse is returned as an `InvalidWorkflowInfo` rather than crashing
 * the whole listing or being silently dropped.
 */
export async function listWorkflows(
  directory: string = process.cwd(),
  includeDisabled = false
): Promise<Array<WorkflowInfo | InvalidWorkflowInfo>> {
  const workflows = await readWorkflowsMap(directory);
  const out: Array<WorkflowInfo | InvalidWorkflowInfo> = [];
  for (const [name, raw] of Object.entries(workflows)) {
    const isDisabled = (raw as Record<string, unknown>)?.["disabled"] === true;
    if (isDisabled && !includeDisabled) continue;
    try {
      const parsed = parseWorkflowEntry(name, raw);
      out.push({ ...parsed, name });
    } catch (e) {
      out.push({
        name,
        invalid: true,
        error: e instanceof Error ? e.message : String(e),
        ...(isDisabled ? { disabled: true } : {}),
      });
    }
  }
  return out;
}

/** Type guard separating valid workflow infos from invalid ones in a listing. */
export function isValidWorkflow(
  w: WorkflowInfo | InvalidWorkflowInfo
): w is WorkflowInfo {
  return !("invalid" in w);
}
