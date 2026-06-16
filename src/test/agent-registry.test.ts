import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getAgentRegistry, assertAgentExists, clearAgentCache, type AgentEntry } from "../config/agent-registry.js";
import type { OpencodeClient } from "@opencode-ai/sdk";

function makeClient(agents: AgentEntry[]): OpencodeClient {
  return {
    app: {
      agents: () =>
        Promise.resolve({ data: agents as any, error: undefined }),
    },
  } as unknown as OpencodeClient;
}

describe("agent-registry", () => {
  afterEach(() => clearAgentCache());

  it("returns agents from the API", async () => {
    const client = makeClient([
      { name: "composer", mode: "subagent" },
      { name: "coder", mode: "subagent" },
    ]);
    const registry = await getAgentRegistry(client);
    assert.equal(registry.length, 2);
    assert.equal(registry[0].name, "composer");
  });

  it("caches after first call", async () => {
    let calls = 0;
    const client = {
      app: {
        agents: () => {
          calls++;
          return Promise.resolve({ data: [{ name: "composer", mode: "subagent" }] as any, error: undefined });
        },
      },
    } as unknown as OpencodeClient;
    await getAgentRegistry(client);
    await getAgentRegistry(client);
    assert.equal(calls, 1);
  });

  it("throws on API error", async () => {
    const client = {
      app: {
        agents: () => Promise.resolve({ data: undefined, error: { message: "not found" } }),
      },
    } as unknown as OpencodeClient;
    await assert.rejects(
      () => getAgentRegistry(client),
      /Failed to fetch agents/
    );
  });

  it("assertAgentExists resolves for a known agent", async () => {
    const client = makeClient([{ name: "composer", mode: "subagent" }]);
    await assert.doesNotReject(() => assertAgentExists(client, "composer"));
  });

  it("assertAgentExists rejects for unknown agent with helpful message", async () => {
    const client = makeClient([{ name: "composer", mode: "subagent" }]);
    await assert.rejects(
      () => assertAgentExists(client, "ghost"),
      /Unknown agent "ghost".*composer/
    );
  });
});
