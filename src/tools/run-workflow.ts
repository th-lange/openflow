import { type OpencodeClient } from "@opencode-ai/sdk";
import { delegateTask } from "./delegate-task.js";
import { getWorkflow } from "./workflow-tools.js";
import { runEvaluatorOptimizer } from "./run-evaluator-optimizer.js";
import { runConditional } from "./run-conditional.js";
import { runFanout } from "./run-fanout.js";
import { runParallel } from "./run-parallel.js";
import { runDebate } from "./run-debate.js";
import { resolveSettings, DEFAULT_CONTEXT_SCOPE, DEFAULT_COMPACT_CONTEXT } from "../config/workflow-loader.js";
import type { SequentialWorkflow, EngineSettings, ContextScope } from "../config/workflow-loader.js";
import { UsageLedger, formatUsageFooter } from "../state/usage-ledger.js";
import { compactForThread } from "../utils/handoff.js";

type StepResult = { label: string; output: string };

function stepLabel(step: SequentialWorkflow["sequence"][number]): string {
  if (typeof step === "string") return step;
  if ("workflow" in step) return `[${step.workflow}]`;
  return "[checkpoint]";
}

/** A step's output as threaded/relayed: its handoff block when compacting, else full. */
function stepView(output: string, compact: boolean): string {
  return compact ? compactForThread(output) : output;
}

/**
 * Build the context threaded into the next step from the prior step results,
 * honouring the workflow's contextScope (#63) and handoff compaction (#64).
 * `all` threads every prior result, `last` only the most recent, `none` nothing.
 * When `compact`, each result is reduced to its handoff block (or a truncated
 * fallback). Step numbering reflects each result's true position so labels stay
 * stable across scopes.
 */
function threadedContext(scope: ContextScope, stepResults: StepResult[], compact: boolean): string {
  if (scope === "none" || stepResults.length === 0) return "";
  const indices =
    scope === "last" ? [stepResults.length - 1] : stepResults.map((_, i) => i);
  return [
    "## Prior step results",
    "",
    ...indices.map(
      (i) => `### Step ${i + 1} — ${stepResults[i].label}\n${stepView(stepResults[i].output, compact)}`
    ),
  ].join("\n");
}

// ── Sequential ────────────────────────────────────────────────────────────────

export async function runSequential(
  workflow: SequentialWorkflow,
  prompt: string,
  initialContext: string | undefined,
  sessionId: string | undefined,
  client: OpencodeClient,
  workDir: string,
  dispatch: typeof runWorkflow,
  settings: EngineSettings,
  ledger: UsageLedger,
  signal?: AbortSignal
): Promise<string> {
  const { sequence } = workflow;
  const scope = workflow.contextScope ?? DEFAULT_CONTEXT_SCOPE;
  const compact = workflow.compactContext ?? DEFAULT_COMPACT_CONTEXT;
  const stepResults: StepResult[] = [];
  // Step 1 sees the context entering the workflow; subsequent steps see prior
  // step outputs as governed by contextScope (#63) and handoff compaction (#64).
  let context = initialContext ?? "";

  for (const step of sequence) {
    let output: string;

    if (typeof step === "string") {
      ({ result: output } = await delegateTask({ agent: step, prompt, context, sessionId }, client, signal, settings.agentTimeoutMs, ledger));
    } else if ("workflow" in step) {
      output = await dispatch(step.workflow, prompt, context, sessionId, client, workDir, signal, settings, ledger);
    } else {
      // checkpoint — top-level commander handles these; if we get here it means
      // something bypassed the load-time checkpoint-reference constraint
      throw new Error(
        "Checkpoint steps cannot be executed via run_workflow. " +
          "The commander must handle this workflow step-by-step."
      );
    }

    stepResults.push({ label: stepLabel(step), output });
    context = threadedContext(scope, stepResults, compact);
  }

  const total = sequence.length;
  const header = `Workflow complete ✅ (${sequence.map(stepLabel).join(" → ")})`;
  // Relay: when compacting, intermediate steps are shown as their handoff and the
  // final step (the deliverable) in full; otherwise every step in full (#64).
  return [
    header,
    "",
    ...stepResults.flatMap(({ label, output }, idx) => [
      `## Step ${idx + 1}/${total} — ${label}`,
      compact && idx < total - 1 ? stepView(output, true) : output,
      "",
    ]),
  ].join("\n");
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function runWorkflow(
  name: string,
  prompt: string,
  context: string | undefined,
  sessionId: string | undefined,
  client: OpencodeClient,
  workDir: string,
  signal?: AbortSignal,
  settings?: EngineSettings,
  ledger?: UsageLedger
): Promise<string> {
  const workflow = await getWorkflow(name, workDir);
  // Resolve engine settings and the usage ledger once at the top level; nested
  // dispatches reuse them so the cost footer aggregates the whole run (#45, #62).
  const isTop = ledger === undefined;
  const resolved = settings ?? (await resolveSettings(workDir));
  const led = ledger ?? new UsageLedger();

  const result = await dispatchPattern(workflow, name, prompt, context, sessionId, client, workDir, resolved, led, signal);

  // Only the outermost call owns the ledger, so it renders the aggregate footer.
  return isTop ? result + formatUsageFooter(led) : result;
}

async function dispatchPattern(
  workflow: Awaited<ReturnType<typeof getWorkflow>>,
  name: string,
  prompt: string,
  context: string | undefined,
  sessionId: string | undefined,
  client: OpencodeClient,
  workDir: string,
  resolved: EngineSettings,
  led: UsageLedger,
  signal?: AbortSignal
): Promise<string> {
  switch (workflow.pattern) {
    case "sequential":
      return runSequential(workflow, prompt, context, sessionId, client, workDir, runWorkflow, resolved, led, signal);
    case "evaluator-optimizer":
      return runEvaluatorOptimizer(workflow, prompt, context, sessionId, client, resolved, led, signal);
    case "conditional":
      return runConditional(workflow, prompt, context, sessionId, client, workDir, runWorkflow, resolved, led, signal);
    case "fanout":
      return runFanout(workflow, prompt, context, sessionId, client, resolved, led, signal);
    case "parallel":
      return runParallel(workflow, prompt, context, sessionId, client, resolved, led, signal);
    case "debate":
      return runDebate(workflow, prompt, context, sessionId, client, resolved, led, signal);
    case "orchestrator":
      throw new Error(
        `Workflow "${name}" uses pattern "orchestrator" which is prompt-driven. ` +
          `Handle it via delegate_task loops per your system instructions.`
      );
  }
}
