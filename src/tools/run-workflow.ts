import { delegateTask } from "./delegate-task.js";
import { getWorkflow } from "./workflow-tools.js";
import { runEvaluatorOptimizer } from "./run-evaluator-optimizer.js";
import { runConditional } from "./run-conditional.js";
import { runFanout } from "./run-fanout.js";
import { runParallel } from "./run-parallel.js";
import { runDebate } from "./run-debate.js";
import type { SequentialWorkflow } from "../config/workflow-loader.js";

// ── Sequential ────────────────────────────────────────────────────────────────

export async function runSequential(
  workflow: SequentialWorkflow,
  prompt: string,
  initialContext: string | undefined,
  sessionId: string | undefined,
  serverUrl: string
): Promise<string> {
  const { sequence } = workflow;

  // Checkpoint steps cannot pause inside a code-driven executor — reject at runtime
  if (sequence.some((step) => typeof step !== "string")) {
    throw new Error(
      "This workflow contains checkpoint steps and must be handled interactively by the commander. " +
        "Do not call run_workflow for it — step through the sequence manually via delegate_task."
    );
  }

  const agentSteps = sequence as string[];
  const stepResults: Array<{ agent: string; output: string }> = [];
  let context = initialContext ?? "";

  for (const agent of agentSteps) {
    const { result } = await delegateTask({ agent, prompt, context, sessionId }, serverUrl);
    stepResults.push({ agent, output: result });

    context = [
      "## Prior step results",
      "",
      ...stepResults.map(({ agent, output }, idx) => `### Step ${idx + 1} — ${agent}\n${output}`),
    ].join("\n");
  }

  const total = agentSteps.length;
  return [
    `Workflow complete ✅ (${agentSteps.join(" → ")})`,
    "",
    ...stepResults.flatMap(({ agent, output }, idx) => [
      `## Step ${idx + 1}/${total} — ${agent}`,
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
      return runSequential(workflow, prompt, context, sessionId, serverUrl);
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
