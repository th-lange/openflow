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
    locked?: boolean;
    sequence: SequenceStep[];
    commanderMayAlsoUse: string[];
};
export type OrchestratorWorkflow = {
    pattern: "orchestrator";
    description?: string;
    disabled?: boolean;
    locked?: boolean;
    agents: string[];
    maxIterations: number;
    satisfactionCriteria: string;
};
export type EvaluatorOptimizerWorkflow = {
    pattern: "evaluator-optimizer";
    description?: string;
    disabled?: boolean;
    locked?: boolean;
    producer: string;
    evaluator: string;
    maxIterations: number;
    passCriteria: string;
};
export type ConditionalWorkflow = {
    pattern: "conditional";
    description?: string;
    disabled?: boolean;
    locked?: boolean;
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
    locked?: boolean;
    agents: string[];
    picker: string;
    pickerPrompt?: string;
};
export type ParallelWorkflow = {
    pattern: "parallel";
    description?: string;
    disabled?: boolean;
    locked?: boolean;
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
    locked?: boolean;
    proposer: string;
    critic: string;
    rounds: number;
    judge: string;
};
export type Workflow = SequentialWorkflow | OrchestratorWorkflow | EvaluatorOptimizerWorkflow | ConditionalWorkflow | FanoutWorkflow | ParallelWorkflow | DebateWorkflow;
export type WorkflowRegistry = Record<string, Workflow>;
export type EngineSettings = {
    /** Per-agent delegation timeout in milliseconds. */
    agentTimeoutMs: number;
    /** Maximum number of agents dispatched concurrently (fan-out/parallel). */
    maxConcurrent: number;
};
export declare const DEFAULT_SETTINGS: EngineSettings;
/**
 * Merge an optional `settings` block (as read from openflow.json) with
 * environment-variable overrides and the built-in defaults. Environment
 * variables take precedence over the file so operators can tune a running
 * install without editing config. Throws on malformed values so a bad setting
 * is caught at startup rather than silently ignored.
 */
export declare function mergeSettings(raw: unknown): EngineSettings;
/**
 * Resolve engine settings from `openflow.json` in `directory`, merged with
 * environment overrides and defaults. Missing file or missing `settings` block
 * yields the defaults.
 */
export declare function resolveSettings(directory?: string): Promise<EngineSettings>;
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