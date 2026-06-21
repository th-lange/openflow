import { type OpencodeClient } from "@opencode-ai/sdk";
export type AgentModel = {
    providerID: string;
    modelID: string;
};
export type AgentEntry = {
    name: string;
    description?: string;
    mode: "subagent" | "primary" | "all";
    /** Explicit model, when the agent sets one. Absent agents use the OpenCode default. */
    model?: AgentModel;
};
export declare function getAgentRegistry(client: OpencodeClient): Promise<AgentEntry[]>;
/** Render a model as `providerID/modelID`, or undefined when no model is set. */
export declare function formatModel(model?: AgentModel): string | undefined;
/** The `providerID/modelID` label for a named agent, or undefined (default model / unknown). */
export declare function agentModelLabel(client: OpencodeClient, name: string): Promise<string | undefined>;
/** List agents, optionally filtered by mode. Read-only (backs the list_agents tool). */
export declare function listAgents(client: OpencodeClient, mode?: AgentEntry["mode"]): Promise<AgentEntry[]>;
export declare function assertAgentExists(client: OpencodeClient, name: string): Promise<void>;
export declare function clearAgentCache(): void;
//# sourceMappingURL=agent-registry.d.ts.map