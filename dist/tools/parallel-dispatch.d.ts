import { type OpencodeClient } from "@opencode-ai/sdk";
import type { DelegateTaskInput } from "./delegate-task.js";
import type { UsageLedger } from "../state/usage-ledger.js";
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
    /** Usage ledger to accumulate each branch's token/cost into (#62). */
    ledger?: UsageLedger;
};
export declare function parallelDispatch(tasks: DelegateTaskInput[], client: OpencodeClient, signal?: AbortSignal, options?: DispatchOptions): Promise<DispatchResult[]>;
//# sourceMappingURL=parallel-dispatch.d.ts.map