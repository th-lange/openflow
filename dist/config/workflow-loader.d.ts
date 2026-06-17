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
export declare function loadWorkflows(client: OpencodeClient, directory?: string): Promise<WorkflowRegistry>;
//# sourceMappingURL=workflow-loader.d.ts.map