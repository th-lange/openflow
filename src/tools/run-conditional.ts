import { type OpencodeClient } from "@opencode-ai/sdk";
import { delegateTask } from "./delegate-task.js";
import { parseOpenflowBlock } from "../utils/openflow-block.js";
import type { ConditionalWorkflow, EngineSettings } from "../config/workflow-loader.js";

export type WorkflowDispatch = (
  name: string,
  prompt: string,
  context: string | undefined,
  sessionId: string | undefined,
  client: OpencodeClient,
  workDir: string,
  signal?: AbortSignal,
  settings?: EngineSettings
) => Promise<string>;

export async function runConditional(
  workflow: ConditionalWorkflow,
  prompt: string,
  context: string | undefined,
  sessionId: string | undefined,
  client: OpencodeClient,
  workDir: string,
  dispatch: WorkflowDispatch,
  settings: EngineSettings,
  signal?: AbortSignal
): Promise<string> {
  const { router, routes, default: defaultWorkflow } = workflow;
  const conditions = routes.map((r) => r.condition);

  // Ask the router to classify the request and emit an openflow route block
  const routerPrompt = [
    prompt,
    "",
    `Classify this request into exactly one of: ${conditions.join(", ")}.`,
    "End your response with an openflow route block:",
    "```openflow",
    `{"route":"<one of: ${conditions.join(", ")}>"}`,
    "```",
  ].join("\n");

  const { result: routerOutput } = await delegateTask(
    { agent: router, prompt: routerPrompt, context, sessionId },
    client,
    signal,
    settings.agentTimeoutMs
  );

  const block = parseOpenflowBlock(routerOutput);
  const routeLabel = typeof block?.route === "string" ? block.route : null;

  const matched = routes.find((r) => r.condition === routeLabel);
  const targetName = matched ? matched.workflow : defaultWorkflow;

  const routingNote = matched
    ? `Routing → ${targetName} (matched: "${routeLabel}")`
    : `No route matched "${routeLabel ?? "(none)"}". Using default: ${targetName}`;

  const targetResult = await dispatch(targetName, prompt, context, sessionId, client, workDir, signal, settings);
  return `${routingNote}\n\n${targetResult}`;
}
