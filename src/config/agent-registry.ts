import { type OpencodeClient } from "@opencode-ai/sdk";

export type AgentEntry = {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
};

let cache: AgentEntry[] | null = null;

export async function getAgentRegistry(
  client: OpencodeClient
): Promise<AgentEntry[]> {
  if (cache) return cache;
  const result = await client.app.agents();
  if (result.error) throw new Error(`Failed to fetch agents: ${JSON.stringify(result.error)}`);
  cache = (result.data ?? []).map((a) => ({
    name: a.name,
    description: a.description,
    mode: a.mode,
  }));
  return cache;
}

export async function assertAgentExists(
  client: OpencodeClient,
  name: string
): Promise<void> {
  const registry = await getAgentRegistry(client);
  const found = registry.some((a) => a.name === name);
  if (!found) {
    const available = registry.map((a) => a.name).join(", ");
    throw new Error(
      `Unknown agent "${name}". Available agents: ${available}`
    );
  }
}

export function clearAgentCache() {
  cache = null;
}
