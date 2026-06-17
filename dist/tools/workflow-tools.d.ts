import type { Workflow } from "../config/workflow-loader.js";
export type WorkflowInfo = Workflow & {
    name: string;
};
export declare function summariseWorkflow(w: WorkflowInfo): string;
export declare function getWorkflow(name: string, directory?: string): Promise<WorkflowInfo>;
export declare function listWorkflows(directory?: string, includeDisabled?: boolean): Promise<WorkflowInfo[]>;
//# sourceMappingURL=workflow-tools.d.ts.map