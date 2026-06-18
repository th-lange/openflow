import { z } from "zod";
import { assertAgentExists } from "../config/agent-registry.js";
import { stepStore } from "../state/step-store.js";
// ── Types (#10) ──────────────────────────────────────────────────────────────
export const DelegateTaskInputSchema = z.object({
    agent: z.string().describe("Name of the agent to delegate to"),
    prompt: z.string().describe("Task prompt to send to the agent"),
    context: z.string().optional().describe("Prior step outputs to inject as context"),
    sessionId: z.string().optional().describe("Parent session ID for state tracking"),
});
// ── Handler (#11 + #12) ──────────────────────────────────────────────────────
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Delegate a task to a named agent in a child session.
 *
 * Takes an already-connected OpencodeClient (injected by the plugin host — see
 * ADR 0001 / #39) rather than constructing one from a URL. An optional
 * AbortSignal lets the OpenCode tool runtime cancel the delegation.
 */
export async function delegateTask(input, client, signal) {
    const { agent, prompt, context, sessionId } = DelegateTaskInputSchema.parse(input);
    // Validate the agent exists before spawning anything (#12: fail fast)
    await assertAgentExists(client, agent);
    // Build the prompt, prepending prior step context if provided (#15)
    const fullPrompt = context
        ? `## Context from prior steps\n\n${context}\n\n## Your task\n\n${prompt}`
        : prompt;
    // Create child session
    let childSessionId;
    try {
        const createResult = await client.session.create({ body: {} });
        if (createResult.error) {
            throw new Error(`Session create failed: ${JSON.stringify(createResult.error)}`);
        }
        childSessionId = createResult.data.id;
    }
    catch (e) {
        throw wrapError(e, `Failed to create child session for agent "${agent}"`);
    }
    // Send prompt, racing against a timeout and an optional external abort (#12).
    let result;
    try {
        const promptPromise = client.session.prompt({
            path: { id: childSessionId },
            body: {
                agent,
                parts: [{ type: "text", text: fullPrompt }],
            },
        });
        const promptResult = await Promise.race([
            promptPromise,
            rejectAfter(TIMEOUT_MS, `Agent "${agent}" timed out after ${TIMEOUT_MS / 1000}s`),
            ...(signal ? [rejectOnAbort(signal, `Agent "${agent}" was cancelled`)] : []),
        ]);
        if (promptResult.error) {
            throw new Error(`Prompt failed: ${JSON.stringify(promptResult.error)}`);
        }
        const textParts = (promptResult.data.parts ?? []).filter((p) => p.type === "text");
        result = textParts.map((p) => p.text).join("").trim();
        if (!result)
            result = "(no text response)";
    }
    catch (e) {
        // Always clean up the child session on error (#12: no session leaks)
        await client.session.delete({ path: { id: childSessionId } }).catch(() => { });
        throw wrapError(e, `Agent "${agent}" failed`);
    }
    // Record step in state store if we have a parent session (#14)
    let stepIndex;
    if (sessionId) {
        const state = stepStore.get(sessionId);
        if (state) {
            stepIndex = state.currentStep;
            const summary = result.length > 500 ? result.slice(0, 497) + "..." : result;
            stepStore.recordStep(sessionId, agent, summary);
        }
    }
    // Clean up child session
    await client.session.delete({ path: { id: childSessionId } }).catch(() => { });
    return { result, childSessionId, stepIndex };
}
function rejectAfter(ms, message) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}
function rejectOnAbort(signal, message) {
    return new Promise((_, reject) => {
        if (signal.aborted)
            return reject(new Error(message));
        signal.addEventListener("abort", () => reject(new Error(message)), { once: true });
    });
}
function wrapError(e, prefix) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Error(`${prefix}: ${msg}`);
}
//# sourceMappingURL=delegate-task.js.map