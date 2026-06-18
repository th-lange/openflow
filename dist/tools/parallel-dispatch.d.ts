import { type OpencodeClient } from "@opencode-ai/sdk";
import type { DelegateTaskInput } from "./delegate-task.js";
export type DispatchResult = {
    index: number;
    agent: string;
    output: string;
    error?: string;
};
export declare function parallelDispatch(tasks: DelegateTaskInput[], client: OpencodeClient, signal?: AbortSignal): Promise<DispatchResult[]>;
//# sourceMappingURL=parallel-dispatch.d.ts.map