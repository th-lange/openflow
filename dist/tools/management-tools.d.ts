import { type OpencodeClient } from "@opencode-ai/sdk";
import { type Workflow } from "../config/workflow-loader.js";
type SequenceStepInput = string | {
    workflow: string;
} | {
    checkpoint: string;
};
export type CreateWorkflowInput = {
    name: string;
    description?: string;
    force?: boolean;
    /** Defaults to "sequential" when omitted. */
    pattern?: Workflow["pattern"];
    sequence?: SequenceStepInput[];
    commanderMayAlsoUse?: string[];
    agents?: string[];
    satisfactionCriteria?: string;
    maxIterations?: number;
    producer?: string;
    evaluator?: string;
    passCriteria?: string;
    router?: string;
    routes?: Array<{
        condition: string;
        workflow: string;
    }>;
    default?: string;
    picker?: string;
    pickerPrompt?: string;
    subtasks?: Array<{
        agent: string;
        prompt: string;
    }>;
    merger?: string;
    proposer?: string;
    critic?: string;
    judge?: string;
    rounds?: number;
};
export declare function createWorkflow(input: CreateWorkflowInput, client: OpencodeClient, directory?: string): Promise<string>;
export declare function enableWorkflow(name: string, directory?: string): Promise<string>;
export declare function disableWorkflow(name: string, directory?: string): Promise<string>;
export type CreateAgentInput = {
    name: string;
    prompt: string;
    description?: string;
    mode?: "subagent" | "primary" | "all";
    model?: string;
    allowEdit?: boolean;
    allowBash?: boolean;
    force?: boolean;
};
export declare function createAgent(input: CreateAgentInput, directory?: string): Promise<string>;
export {};
//# sourceMappingURL=management-tools.d.ts.map