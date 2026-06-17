import { delegateTask } from "./delegate-task.js";
import type { SequentialWorkflow } from "../config/workflow-loader.js";

export async function runSequential(
  workflow: SequentialWorkflow,
  prompt: string,
  initialContext: string | undefined,
  sessionId: string | undefined,
  serverUrl: string
): Promise<string> {
  const { sequence } = workflow;
  const stepResults: Array<{ agent: string; output: string }> = [];
  let context = initialContext ?? "";

  for (let i = 0; i < sequence.length; i++) {
    const agent = sequence[i];
    const { result } = await delegateTask({ agent, prompt, context, sessionId }, serverUrl);
    stepResults.push({ agent, output: result });

    // Build context block for the next step
    context = [
      "## Prior step results",
      "",
      ...stepResults.map(
        ({ agent, output }, idx) => `### Step ${idx + 1} — ${agent}\n${output}`
      ),
    ].join("\n");
  }

  const total = sequence.length;
  const sections = stepResults.flatMap(({ agent, output }, idx) => [
    `## Step ${idx + 1}/${total} — ${agent}`,
    output,
    "",
  ]);

  return [`Workflow complete ✅ (${sequence.join(" → ")})`, "", ...sections].join("\n");
}
