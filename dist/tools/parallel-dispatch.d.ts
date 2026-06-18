import { type OpencodeClient } from "@opencode-ai/sdk";
import type { DelegateTaskInput } from "./delegate-task.js";
export type DispatchResult = {
    index: number;
    agent: string;
    output: string;
    error?: string;
};
export type DispatchOptions = {
    /** Maximum agents in flight at once (default: 5). */
    maxConcurrent?: number;
    /** Per-agent timeout in milliseconds, forwarded to delegateTask. */
    timeoutMs?: number;
};
export declare function parallelDispatch(tasks: DelegateTaskInput[], client: OpencodeClient, signal?: AbortSignal, options?: DispatchOptions): Promise<DispatchResult[]>;
//# sourceMappingURL=parallel-dispatch.d.ts.map