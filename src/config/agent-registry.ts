import { type OpencodeClient } from "@opencode-ai/sdk";

export type AgentModel = { providerID: string; modelID: string };

export type AgentEntry = {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  /** Explicit model, when the agent sets one. Absent agents use the OpenCode default. */
  model?: AgentModel;
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
    ...(a.model ? { model: { providerID: a.model.providerID, modelID: a.model.modelID } } : {}),
  }));
  return cache;
}

/** Render a model as `providerID/modelID`, or undefined when no model is set. */
export function formatModel(model?: AgentModel): string | undefined {
  return model ? `${model.providerID}/${model.modelID}` : undefined;
}

/** The `providerID/modelID` label for a named agent, or undefined (default model / unknown). */
export async function agentModelLabel(
  client: OpencodeClient,
  name: string
): Promise<string | undefined> {
  const registry = await getAgentRegistry(client);
  return formatModel(registry.find((a) => a.name === name)?.model);
}

/** List agents, optionally filtered by mode. Read-only (backs the list_agents tool). */
export async function listAgents(
  client: OpencodeClient,
  mode?: AgentEntry["mode"]
): Promise<AgentEntry[]> {
  const registry = await getAgentRegistry(client);
  return mode ? registry.filter((a) => a.mode === mode) : registry;
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
