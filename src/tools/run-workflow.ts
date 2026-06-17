import { delegateTask } from "./delegate-task.js";
import { getWorkflow } from "./workflow-tools.js";
import { runEvaluatorOptimizer } from "./run-evaluator-optimizer.js";
import { runConditional } from "./run-conditional.js";
import { runFanout } from "./run-fanout.js";
import { runParallel } from "./run-parallel.js";
import { runDebate } from "./run-debate.js";
import type { SequentialWorkflow } from "../config/workflow-loader.js";

type StepResult = { label: string; output: string };

function stepLabel(step: SequentialWorkflow["sequence"][number]): string {
  if (typeof step === "string") return step;
  if ("workflow" in step) return `[${step.workflow}]`;
  return "[checkpoint]";
}

// ── Sequential ────────────────────────────────────────────────────────────────

export async function runSequential(
  workflow: SequentialWorkflow,
  prompt: string,
  initialContext: string | undefined,
  sessionId: string | undefined,
  serverUrl: string,
  workDir: string,
  dispatch: typeof runWorkflow
): Promise<string> {
  const { sequence } = workflow;
  const stepResults: StepResult[] = [];
  let context = initialContext ?? "";

  for (const step of sequence) {
    let output: string;

    if (typeof step === "string") {
      ({ result: output } = await delegateTask({ agent: step, prompt, context, sessionId }, serverUrl));
    } else if ("workflow" in step) {
      output = await dispatch(step.workflow, prompt, context, sessionId, serverUrl, workDir);
    } else {
      // checkpoint — top-level commander handles these; if we get here it means
      // something bypassed the load-time checkpoint-reference constraint
      throw new Error(
        "Checkpoint steps cannot be executed via run_workflow. " +
          "The commander must handle this workflow step-by-step."
      );
    }

    stepResults.push({ label: stepLabel(step), output });
    context = [
      "## Prior step results",
      "",
      ...stepResults.map(({ label, output }, idx) => `### Step ${idx + 1} — ${label}\n${output}`),
    ].join("\n");
  }

  const total = sequence.length;
  const header = `Workflow complete ✅ (${sequence.map(stepLabel).join(" → ")})`;
  return [
    header,
    "",
    ...stepResults.flatMap(({ label, output }, idx) => [
      `## Step ${idx + 1}/${total} — ${label}`,
      output,
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
  serverUrl: string,
  workDir: string
): Promise<string> {
  const workflow = await getWorkflow(name, workDir);

  switch (workflow.pattern) {
    case "sequential":
      return runSequential(workflow, prompt, context, sessionId, serverUrl, workDir, runWorkflow);
    case "evaluator-optimizer":
      return runEvaluatorOptimizer(workflow, prompt, context, sessionId, serverUrl);
    case "conditional":
      return runConditional(workflow, prompt, context, sessionId, serverUrl, workDir, runWorkflow);
    case "fanout":
      return runFanout(workflow, prompt, context, sessionId, serverUrl);
    case "parallel":
      return runParallel(workflow, prompt, context, sessionId, serverUrl);
    case "debate":
      return runDebate(workflow, prompt, context, sessionId, serverUrl);
    case "orchestrator":
      throw new Error(
        `Workflow "${name}" uses pattern "orchestrator" which is prompt-driven. ` +
          `Handle it via delegate_task loops per your system instructions.`
      );
  }
}
