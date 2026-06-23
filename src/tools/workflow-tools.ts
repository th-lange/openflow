import {
  parseWorkflowEntry,
  resolveWorkflowMaps,
  type Workflow,
  type WorkflowOrigin,
} from "../config/workflow-loader.js";

export type WorkflowInfo = Workflow & { name: string; origin?: WorkflowOrigin };

/** An entry that failed to parse — surfaced in listings so it isn't silently hidden. */
export type InvalidWorkflowInfo = {
  name: string;
  invalid: true;
  error: string;
  disabled?: boolean;
  origin?: WorkflowOrigin;
};

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
  const { merged, origin } = await resolveWorkflowMaps(directory);
  const raw = merged[name];
  if (!raw || typeof raw !== "object") {
    const available = Object.keys(merged)
      .filter((k) => (merged[k] as Record<string, unknown>)?.["disabled"] !== true)
      .join(", ");
    throw new Error(`Workflow "${name}" not found. Available: ${available || "(none)"}`);
  }
  const parsed = parseWorkflowEntry(name, raw);
  if (parsed.disabled) {
    throw new Error(`Workflow "${name}" is disabled`);
  }
  return { ...parsed, name, origin: origin[name] };
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
  const { merged, origin } = await resolveWorkflowMaps(directory);
  const out: Array<WorkflowInfo | InvalidWorkflowInfo> = [];
  for (const [name, raw] of Object.entries(merged)) {
    const isDisabled = (raw as Record<string, unknown>)?.["disabled"] === true;
    if (isDisabled && !includeDisabled) continue;
    try {
      const parsed = parseWorkflowEntry(name, raw);
      out.push({ ...parsed, name, origin: origin[name] });
    } catch (e) {
      out.push({
        name,
        invalid: true,
        error: e instanceof Error ? e.message : String(e),
        ...(isDisabled ? { disabled: true } : {}),
        origin: origin[name],
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
