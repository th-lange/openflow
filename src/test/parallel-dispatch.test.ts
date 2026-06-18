import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parallelDispatch } from "../tools/parallel-dispatch.js";
import { clearAgentCache } from "../config/agent-registry.js";
import { makeFakeClient, delay } from "./fake-client.js";

describe("parallelDispatch", () => {
  afterEach(clearAgentCache);

  it("returns results in task order even when they finish out of order", async () => {
    const client = makeFakeClient({
      agents: ["a", "b", "c"],
      respond: async (agent) => {
        await delay(agent === "a" ? 30 : agent === "b" ? 10 : 20);
        return `${agent}-out`;
      },
    });
    const tasks = [
      { agent: "a", prompt: "1" },
      { agent: "b", prompt: "2" },
      { agent: "c", prompt: "3" },
    ];
    const results = await parallelDispatch(tasks, client);
    assert.deepEqual(
      results.map((r) => ({ index: r.index, agent: r.agent, output: r.output })),
      [
        { index: 0, agent: "a", output: "a-out" },
        { index: 1, agent: "b", output: "b-out" },
        { index: 2, agent: "c", output: "c-out" },
      ]
    );
  });

  it("captures per-task errors without failing the whole batch", async () => {
    const client = makeFakeClient({
      agents: ["a", "b"],
      respond: (agent) => {
        if (agent === "b") throw new Error("nope");
        return "ok";
      },
    });
    const results = await parallelDispatch(
      [
        { agent: "a", prompt: "1" },
        { agent: "b", prompt: "2" },
      ],
      client
    );
    assert.equal(results[0].error, undefined);
    assert.equal(results[0].output, "ok");
    assert.match(results[1].error!, /nope/);
  });

  it("never exceeds maxConcurrent in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const client = makeFakeClient({
      agents: ["x"],
      respond: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await delay(15);
        inFlight--;
        return "ok";
      },
    });
    const tasks = Array.from({ length: 12 }, (_, i) => ({ agent: "x", prompt: String(i) }));
    const results = await parallelDispatch(tasks, client, undefined, { maxConcurrent: 3 });
    assert.equal(results.length, 12);
    assert.ok(peak <= 3, `peak concurrency ${peak} exceeded 3`);
    assert.ok(peak >= 2, `expected real concurrency, peak was ${peak}`);
  });
});
