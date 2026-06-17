import { type OpencodeClient } from "@opencode-ai/sdk";
export type CreateWorkflowInput = {
    name: string;
    sequence: string[];
    description?: string;
    commanderMayAlsoUse?: string[];
    force?: boolean;
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
//# sourceMappingURL=management-tools.d.ts.map