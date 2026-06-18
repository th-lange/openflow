import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { listAgents, clearAgentCache } from "../config/agent-registry.js";

function clientWith(agents: Array<{ name: string; mode: string; description?: string }>): OpencodeClient {
  return {
    app: { agents: () => Promise.resolve({ data: agents as any, error: undefined }) },
  } as unknown as OpencodeClient;
}

describe("listAgents", () => {
  afterEach(clearAgentCache);

  it("returns all agents with name, mode and description", async () => {
    const client = clientWith([
      { name: "commander", mode: "primary", description: "orchestrates" },
      { name: "coder", mode: "subagent", description: "implements" },
    ]);
    const agents = await listAgents(client);
    assert.equal(agents.length, 2);
    assert.deepEqual(
      agents.map((a) => a.name),
      ["commander", "coder"]
    );
    assert.equal(agents[0].description, "orchestrates");
  });

  it("filters by mode when requested", async () => {
    const client = clientWith([
      { name: "commander", mode: "primary" },
      { name: "coder", mode: "subagent" },
      { name: "analyzer", mode: "subagent" },
    ]);
    const subs = await listAgents(client, "subagent");
    assert.deepEqual(
      subs.map((a) => a.name),
      ["coder", "analyzer"]
    );
  });
});
