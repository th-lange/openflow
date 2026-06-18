import { type OpencodeClient } from "@opencode-ai/sdk";
export type AgentEntry = {
    name: string;
    description?: string;
    mode: "subagent" | "primary" | "all";
};
export declare function getAgentRegistry(client: OpencodeClient): Promise<AgentEntry[]>;
/** List agents, optionally filtered by mode. Read-only (backs the list_agents tool). */
export declare function listAgents(client: OpencodeClient, mode?: AgentEntry["mode"]): Promise<AgentEntry[]>;
export declare function assertAgentExists(client: OpencodeClient, name: string): Promise<void>;
export declare function clearAgentCache(): void;
//# sourceMappingURL=agent-registry.d.ts.map