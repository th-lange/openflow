import { type Workflow } from "../config/workflow-loader.js";
export type WorkflowInfo = Workflow & {
    name: string;
};
/** An entry that failed to parse — surfaced in listings so it isn't silently hidden. */
export type InvalidWorkflowInfo = {
    name: string;
    invalid: true;
    error: string;
    disabled?: boolean;
};
export declare function summariseWorkflow(w: WorkflowInfo): string;
/**
 * Look up and parse a single workflow by name. Uses the same parser as the
 * startup validator (#38), so a workflow that `getWorkflow` accepts is one the
 * loader would too. Throws on unknown, disabled, or malformed workflows.
 */
export declare function getWorkflow(name: string, directory?: string): Promise<WorkflowInfo>;
/**
 * List workflows. Parses each entry with the canonical parser; an entry that
 * fails to parse is returned as an `InvalidWorkflowInfo` rather than crashing
 * the whole listing or being silently dropped.
 */
export declare function listWorkflows(directory?: string, includeDisabled?: boolean): Promise<Array<WorkflowInfo | InvalidWorkflowInfo>>;
/** Type guard separating valid workflow infos from invalid ones in a listing. */
export declare function isValidWorkflow(w: WorkflowInfo | InvalidWorkflowInfo): w is WorkflowInfo;
//# sourceMappingURL=workflow-tools.d.ts.map