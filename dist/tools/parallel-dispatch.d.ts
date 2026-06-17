import type { DelegateTaskInput } from "./delegate-task.js";
export type DispatchResult = {
    index: number;
    agent: string;
    output: string;
    error?: string;
};
export declare function parallelDispatch(tasks: DelegateTaskInput[], serverUrl: string): Promise<DispatchResult[]>;
//# sourceMappingURL=parallel-dispatch.d.ts.map