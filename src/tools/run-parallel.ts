import { delegateTask } from "./delegate-task.js";
import { parallelDispatch } from "./parallel-dispatch.js";
import type { ParallelWorkflow } from "../config/workflow-loader.js";

export async function runParallel(
  workflow: ParallelWorkflow,
  prompt: string,
  context: string | undefined,
  sessionId: string | undefined,
  serverUrl: string
): Promise<string> {
  const { subtasks, merger } = workflow;

  // Pass the user's overall task as context so each subtask agent understands the bigger picture
  const subtaskContext = [
    context,
    prompt ? `## Overall task\n${prompt}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const tasks = subtasks.map((s) => ({
    agent: s.agent,
    prompt: s.prompt,
    context: subtaskContext || undefined,
    sessionId,
  }));

  const results = await parallelDispatch(tasks, serverUrl);

  const successful = results.filter((r) => !r.error);
  if (successful.length === 0) {
    throw new Error(`All ${subtasks.length} parallel subtasks failed`);
  }

  const resultsContext = results
    .map((r, i) => {
      const label = subtasks[r.index]?.prompt ?? r.agent;
      return r.error
        ? `## Subtask ${i + 1} — ${r.agent} (FAILED)\nError: ${r.error}`
        : `## Subtask ${i + 1} — ${r.agent}\n_Task: ${label}_\n\n${r.output}`;
    })
    .join("\n\n");

  const mergerPrompt = [
    "Consolidate the subtask results in the context above into a coherent whole.",
    ...(results.some((r) => r.error)
      ? [`Note: some subtasks failed (marked above). Work with what succeeded.`]
      : []),
  ].join("\n");

  const { result: mergerOutput } = await delegateTask(
    { agent: merger, prompt: mergerPrompt, context: resultsContext, sessionId },
    serverUrl
  );

  return [
    `Parallel complete ✅ — ${successful.length}/${subtasks.length} subtasks succeeded`,
    "",
    "## Consolidated result",
    mergerOutput,
  ].join("\n");
}
