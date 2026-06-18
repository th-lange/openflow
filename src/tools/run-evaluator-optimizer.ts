import { type OpencodeClient } from "@opencode-ai/sdk";
import { delegateTask } from "./delegate-task.js";
import { parseOpenflowBlock } from "../utils/openflow-block.js";
import type { EvaluatorOptimizerWorkflow } from "../config/workflow-loader.js";

export async function runEvaluatorOptimizer(
  workflow: EvaluatorOptimizerWorkflow,
  prompt: string,
  initialContext: string | undefined,
  sessionId: string | undefined,
  client: OpencodeClient,
  signal?: AbortSignal
): Promise<string> {
  const { producer, evaluator, maxIterations, passCriteria } = workflow;
  let lastProducerOutput = "";
  let feedback = "";

  for (let i = 1; i <= maxIterations; i++) {
    // Build producer context: initial context + any evaluator feedback from the previous iteration
    const producerContext = [
      initialContext,
      feedback ? `## Evaluator feedback from iteration ${i - 1}\n${feedback}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const { result: producerOutput } = await delegateTask(
      { agent: producer, prompt, context: producerContext || undefined, sessionId },
      client,
      signal
    );
    lastProducerOutput = producerOutput;

    // Instruct the evaluator to emit an openflow verdict block so we can parse the result
    const evaluatorPrompt = [
      prompt,
      "",
      "Evaluate the producer output in the context above against the original task requirements.",
      "End your response with an openflow verdict block:",
      "```openflow",
      '{"verdict":"PASS","feedback":""}',
      "```",
      "or if there are issues:",
      "```openflow",
      '{"verdict":"FAIL","feedback":"<specific actionable feedback for the producer>"}',
      "```",
    ].join("\n");

    const { result: evaluatorOutput } = await delegateTask(
      {
        agent: evaluator,
        prompt: evaluatorPrompt,
        context: `## Producer output (iteration ${i})\n\n${producerOutput}`,
        sessionId,
      },
      client,
      signal
    );

    // Missing or malformed block → treat as FAIL and continue (per #31 contract)
    const block = parseOpenflowBlock(evaluatorOutput);
    const verdict = typeof block?.verdict === "string" ? block.verdict : null;
    feedback =
      typeof block?.feedback === "string" && block.feedback ? block.feedback : evaluatorOutput;

    if (verdict !== null && verdict.includes(passCriteria)) {
      return [
        `Evaluator-optimizer complete ✅ — passed on iteration ${i}/${maxIterations}`,
        "",
        "## Final producer output",
        lastProducerOutput,
        "",
        "## Evaluator verdict",
        evaluatorOutput,
      ].join("\n");
    }
  }

  return [
    `Evaluator-optimizer exhausted ⚠️ — did not reach "${passCriteria}" in ${maxIterations} iteration(s). Best-effort result:`,
    "",
    `## Final producer output (iteration ${maxIterations})`,
    lastProducerOutput,
  ].join("\n");
}
