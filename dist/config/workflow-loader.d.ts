import { type OpencodeClient } from "@opencode-ai/sdk";
export type SequenceStep = string | {
    checkpoint: string;
} | {
    workflow: string;
};
export type SequentialWorkflow = {
    pattern: "sequential";
    description?: string;
    disabled?: boolean;
    sequence: SequenceStep[];
    commanderMayAlsoUse: string[];
};
export type OrchestratorWorkflow = {
    pattern: "orchestrator";
    description?: string;
    disabled?: boolean;
    agents: string[];
    maxIterations: number;
    satisfactionCriteria: string;
};
export type EvaluatorOptimizerWorkflow = {
    pattern: "evaluator-optimizer";
    description?: string;
    disabled?: boolean;
    producer: string;
    evaluator: string;
    maxIterations: number;
    passCriteria: string;
};
export type ConditionalWorkflow = {
    pattern: "conditional";
    description?: string;
    disabled?: boolean;
    router: string;
    routes: Array<{
        condition: string;
        workflow: string;
    }>;
    default: string;
};
export type FanoutWorkflow = {
    pattern: "fanout";
    description?: string;
    disabled?: boolean;
    agents: string[];
    picker: string;
    pickerPrompt?: string;
};
export type ParallelWorkflow = {
    pattern: "parallel";
    description?: string;
    disabled?: boolean;
    subtasks: Array<{
        agent: string;
        prompt: string;
    }>;
    merger: string;
};
export type DebateWorkflow = {
    pattern: "debate";
    description?: string;
    disabled?: boolean;
    proposer: string;
    critic: string;
    rounds: number;
    judge: string;
};
export type Workflow = SequentialWorkflow | OrchestratorWorkflow | EvaluatorOptimizerWorkflow | ConditionalWorkflow | FanoutWorkflow | ParallelWorkflow | DebateWorkflow;
export type WorkflowRegistry = Record<string, Workflow>;
/**
 * Read and parse `openflow.json` (JSON or JSONC) from `directory`.
 * Returns the parsed top-level value, or `undefined` when the file is absent.
 * Throws when the file exists but is not valid JSON/JSONC.
 *
 * This is the one read path shared by the validating loader and the runtime
 * lookup tools (see workflow-tools.ts) — #38.
 */
export declare function readOpenflowFile(directory?: string): Promise<unknown | undefined>;
export declare function loadWorkflows(client: OpencodeClient, directory?: string): Promise<WorkflowRegistry>;
/**
 * Parse and validate a single workflow entry into a typed `Workflow`.
 * Throws on malformed input. This is the canonical per-entry parser shared by
 * the loader and the runtime lookup tools (#38).
 */
export declare function parseWorkflowEntry(name: string, raw: unknown): Workflow;
//# sourceMappingURL=workflow-loader.d.ts.map