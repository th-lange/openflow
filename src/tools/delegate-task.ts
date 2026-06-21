import { type OpencodeClient, type TextPart } from "@opencode-ai/sdk";
import { z } from "zod";
import { assertAgentExists } from "../config/agent-registry.js";
import { stepStore } from "../state/step-store.js";
import { extractUsage, type Usage, type UsageLedger } from "../state/usage-ledger.js";

// ── Types (#10) ──────────────────────────────────────────────────────────────

export const DelegateTaskInputSchema = z.object({
  agent: z.string().describe("Name of the agent to delegate to"),
  prompt: z.string().describe("Task prompt to send to the agent"),
  context: z.string().optional().describe("Prior step outputs to inject as context"),
  sessionId: z.string().optional().describe("Parent session ID for state tracking"),
});

export type DelegateTaskInput = z.infer<typeof DelegateTaskInputSchema>;

export type DelegateTaskOutput = {
  result: string;
  childSessionId: string;
  stepIndex?: number;
  /** Token/cost for this agent call; zeroed when the provider reports nothing (#62). */
  usage: Usage;
  /** Model that served the call, when the provider reports it. */
  model?: string;
};

// ── Handler (#11 + #12) ──────────────────────────────────────────────────────

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Delegate a task to a named agent in a child session.
 *
 * Takes an already-connected OpencodeClient (injected by the plugin host — see
 * ADR 0001 / #39) rather than constructing one from a URL. An optional
 * AbortSignal lets the OpenCode tool runtime cancel the delegation. The
 * per-agent timeout is configurable via the `settings` block in openflow.json
 * (#45); it defaults to TIMEOUT_MS when not supplied.
 */
export async function delegateTask(
  input: DelegateTaskInput,
  client: OpencodeClient,
  signal?: AbortSignal,
  timeoutMs: number = TIMEOUT_MS,
  ledger?: UsageLedger
): Promise<DelegateTaskOutput> {
  const { agent, prompt, context, sessionId } = DelegateTaskInputSchema.parse(input);

  // Validate the agent exists before spawning anything (#12: fail fast)
  await assertAgentExists(client, agent);

  // Build the prompt, prepending prior step context if provided (#15)
  const fullPrompt = context
    ? `## Context from prior steps\n\n${context}\n\n## Your task\n\n${prompt}`
    : prompt;

  // Create child session
  let childSessionId: string;
  try {
    const createResult = await client.session.create({ body: {} });
    if (createResult.error) {
      throw new Error(`Session create failed: ${JSON.stringify(createResult.error)}`);
    }
    childSessionId = createResult.data!.id;
  } catch (e) {
    throw wrapError(e, `Failed to create child session for agent "${agent}"`);
  }

  // Send prompt, racing against a timeout and an optional external abort (#12).
  // The losing racers (timeout timer, abort listener) are torn down once the
  // race settles so they don't keep the event loop alive (#45).
  let result: string;
  let usage: Usage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let model: string | undefined;
  const cleanups: Array<() => void> = [];
  try {
    const promptPromise = client.session.prompt({
      path: { id: childSessionId },
      body: {
        agent,
        parts: [{ type: "text", text: fullPrompt }],
      },
    });

    const racers: Array<Promise<Awaited<typeof promptPromise>>> = [
      promptPromise,
      rejectAfter(timeoutMs, `Agent "${agent}" timed out after ${timeoutMs / 1000}s`, cleanups),
    ];
    if (signal) racers.push(rejectOnAbort(signal, `Agent "${agent}" was cancelled`, cleanups));

    const promptResult = await Promise.race(racers);

    if (promptResult.error) {
      throw new Error(`Prompt failed: ${JSON.stringify(promptResult.error)}`);
    }

    const textParts = (promptResult.data!.parts ?? []).filter(
      (p): p is TextPart => p.type === "text"
    );
    result = textParts.map((p) => p.text).join("").trim();
    if (!result) result = "(no text response)";

    // Capture token/cost from the assistant message; absent fields default to 0 (#62)
    ({ usage, model } = extractUsage(promptResult.data!.info));
  } catch (e) {
    // Always clean up the child session on error (#12: no session leaks)
    await client.session.delete({ path: { id: childSessionId } }).catch(() => {});
    throw wrapError(e, `Agent "${agent}" failed`);
  } finally {
    for (const fn of cleanups) fn();
  }

  // Record step in state store if we have a parent session (#14)
  let stepIndex: number | undefined;
  if (sessionId) {
    const state = stepStore.get(sessionId);
    if (state) {
      stepIndex = state.currentStep;
      const summary = result.length > 500 ? result.slice(0, 497) + "..." : result;
      stepStore.recordStep(sessionId, agent, summary);
    }
  }

  // Accumulate usage for the run-level cost footer (#62)
  ledger?.record(agent, usage, model);

  // Clean up child session
  await client.session.delete({ path: { id: childSessionId } }).catch(() => {});

  return { result, childSessionId, stepIndex, usage, model };
}

function rejectAfter(ms: number, message: string, cleanups: Array<() => void>): Promise<never> {
  return new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    cleanups.push(() => clearTimeout(timer));
  });
}

function rejectOnAbort(
  signal: AbortSignal,
  message: string,
  cleanups: Array<() => void>
): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) return reject(new Error(message));
    const onAbort = () => reject(new Error(message));
    signal.addEventListener("abort", onAbort, { once: true });
    cleanups.push(() => signal.removeEventListener("abort", onAbort));
  });
}

function wrapError(e: unknown, prefix: string): Error {
  const msg = e instanceof Error ? e.message : String(e);
  return new Error(`${prefix}: ${msg}`);
}
