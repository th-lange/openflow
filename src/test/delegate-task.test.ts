import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { delegateTask } from "../tools/delegate-task.js";
import { clearAgentCache } from "../config/agent-registry.js";
import { makeFakeClient, delay } from "./fake-client.js";

describe("delegateTask", () => {
  afterEach(clearAgentCache);

  it("returns the agent's joined text response", async () => {
    const client = makeFakeClient({ agents: ["coder"], respond: () => "done" });
    const { result } = await delegateTask({ agent: "coder", prompt: "go" }, client);
    assert.equal(result, "done");
  });

  it("prepends prior context under a labelled section", async () => {
    const client = makeFakeClient({ agents: ["coder"], respond: (_a, text) => text });
    const { result } = await delegateTask(
      { agent: "coder", prompt: "implement X", context: "earlier output" },
      client
    );
    assert.match(result, /## Context from prior steps/);
    assert.match(result, /earlier output/);
    assert.match(result, /## Your task/);
    assert.match(result, /implement X/);
  });

  it("sends the bare prompt when no context is given", async () => {
    const client = makeFakeClient({ agents: ["coder"], respond: (_a, text) => text });
    const { result } = await delegateTask({ agent: "coder", prompt: "just this" }, client);
    assert.equal(result, "just this");
  });

  it("rejects when the agent is unknown", async () => {
    const client = makeFakeClient({ agents: ["coder"] });
    await assert.rejects(
      delegateTask({ agent: "ghost", prompt: "go" }, client),
      /Unknown agent "ghost"/
    );
  });

  it("falls back to a placeholder when the response is empty", async () => {
    const client = makeFakeClient({ agents: ["coder"], respond: () => "   " });
    const { result } = await delegateTask({ agent: "coder", prompt: "go" }, client);
    assert.equal(result, "(no text response)");
  });

  it("deletes the child session on success", async () => {
    const client = makeFakeClient({ agents: ["coder"], respond: () => "ok" });
    const { childSessionId } = await delegateTask({ agent: "coder", prompt: "go" }, client);
    assert.deepEqual(client.deleted, [childSessionId]);
  });

  it("deletes the child session when the prompt fails", async () => {
    const client = makeFakeClient({
      agents: ["coder"],
      respond: () => {
        throw new Error("boom");
      },
    });
    await assert.rejects(delegateTask({ agent: "coder", prompt: "go" }, client), /Agent "coder" failed/);
    assert.equal(client.created.length, 1);
    assert.deepEqual(client.deleted, client.created);
  });

  it("times out when the agent exceeds the configured timeout", async () => {
    const client = makeFakeClient({
      agents: ["coder"],
      respond: async () => {
        await delay(100);
        return "late";
      },
    });
    await assert.rejects(
      delegateTask({ agent: "coder", prompt: "go" }, client, undefined, 10),
      /timed out after/
    );
  });

  it("rejects when the abort signal fires", async () => {
    const controller = new AbortController();
    const client = makeFakeClient({
      agents: ["coder"],
      respond: async () => {
        await delay(100);
        return "late";
      },
    });
    const promise = delegateTask({ agent: "coder", prompt: "go" }, client, controller.signal);
    controller.abort();
    await assert.rejects(promise, /was cancelled/);
  });
});
