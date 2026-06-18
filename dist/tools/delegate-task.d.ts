import { type OpencodeClient } from "@opencode-ai/sdk";
import { z } from "zod";
export declare const DelegateTaskInputSchema: z.ZodObject<{
    agent: z.ZodString;
    prompt: z.ZodString;
    context: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type DelegateTaskInput = z.infer<typeof DelegateTaskInputSchema>;
export type DelegateTaskOutput = {
    result: string;
    childSessionId: string;
    stepIndex?: number;
};
/**
 * Delegate a task to a named agent in a child session.
 *
 * Takes an already-connected OpencodeClient (injected by the plugin host — see
 * ADR 0001 / #39) rather than constructing one from a URL. An optional
 * AbortSignal lets the OpenCode tool runtime cancel the delegation.
 */
export declare function delegateTask(input: DelegateTaskInput, client: OpencodeClient, signal?: AbortSignal): Promise<DelegateTaskOutput>;
//# sourceMappingURL=delegate-task.d.ts.map