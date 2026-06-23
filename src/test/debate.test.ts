import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseWorkflowEntry, DEFAULT_SETTINGS } from "../config/workflow-loader.js";
import type { DebateWorkflow } from "../config/workflow-loader.js";
import { runDebate } from "../tools/run-debate.js";
import { UsageLedger } from "../state/usage-ledger.js";
import { HANDOFF_FALLBACK_LIMIT } from "../utils/handoff.js";
import { makeFakeClient } from "./fake-client.js";

const settings = DEFAULT_SETTINGS;

describe("debate compactContext parsing", () => {
  it("accepts a boolean compactContext", () => {
    const w = parseWorkflowEntry("d", {
      pattern: "debate",
      proposer: "p",
      critic: "c",
      judge: "j",
      compactContext: false,
    }) as DebateWorkflow;
    assert.equal(w.compactContext, false);
  });

  it("leaves compactContext undefined when omitted (default applied at runtime)", () => {
    const w = parseWorkflowEntry("d", {
      pattern: "debate",
      proposer: "p",
      critic: "c",
      judge: "j",
    }) as DebateWorkflow;
    assert.equal(w.compactContext, undefined);
  });

  it("rejects a non-boolean compactContext", () => {
    assert.throws(
      () =>
        parseWorkflowEntry("d", {
          pattern: "debate",
          proposer: "p",
          critic: "c",
          judge: "j",
          compactContext: "yes",
        }),
      /compactContext.*must be a boolean/
    );
  });
});

describe("debate inter-turn threading", () => {
  // Each agent call returns a unique, handoff-less body longer than the fallback
  // limit, so compaction must truncate any earlier turn it threads. A shared
  // counter makes every turn's content distinguishable.
  const body = (n: number, agent: string) => `${agent}#${n}:` + "x".repeat(HANDOFF_FALLBACK_LIMIT + 500);

  function clientFor() {
    let n = 0;
    return makeFakeClient({ agents: ["p", "c", "j"], respond: (agent) => body(++n, agent) });
  }

  const debate = (compactContext?: boolean): DebateWorkflow => ({
    pattern: "debate",
    proposer: "p",
    critic: "c",
    rounds: 2,
    judge: "j",
    ...(compactContext !== undefined ? { compactContext } : {}),
  });

  // Call order for rounds=2: [0] proposer opening (no transcript), [1] critic r1,
  // [2] proposer r1, [3] critic r2, [4] proposer rebuttal, [5] judge. Turn bodies
  // by counter: 1=p opening, 2=critic r1, 3=proposer r1, 4=critic r2, 5=rebuttal.

  async function run(compactContext?: boolean) {
    const client = clientFor();
    await runDebate(debate(compactContext), "topic", undefined, "sess", client, settings, new UsageLedger());
    return client;
  }

  it("compacts earlier turns by default while keeping the latest turn full", async () => {
    const client = await run();
    // Proposer r1 (call 2) sees two prior turns: the opening (1) and critic r1 (2).
    const proposerR1 = client.calls[2].text;
    assert.ok(proposerR1.includes("[truncated"), "the earlier opening turn should be truncated");
    assert.ok(!proposerR1.includes(body(1, "p")), "the full opening body must not be threaded");
    assert.ok(proposerR1.includes(body(2, "c")), "the latest turn (critic r1) is threaded in full");
  });

  it("bounds growth: the longest inter-turn context still threads only the latest turn in full", async () => {
    const client = await run();
    // Rebuttal (call 4) accumulates four prior turns; only critic r2 (4) is latest.
    const rebuttal = client.calls[4].text;
    for (const [n, agent] of [[1, "p"], [2, "c"], [3, "p"]] as const) {
      assert.ok(!rebuttal.includes(body(n, agent)), `earlier turn ${n} must be truncated`);
    }
    assert.ok(rebuttal.includes(body(4, "c")), "only the latest turn (critic r2) is full");
  });

  it("threads the full, uncompacted transcript to the judge", async () => {
    const client = await run();
    const judgeCall = client.calls[client.calls.length - 1];
    assert.equal(judgeCall.agent, "j");
    for (const [n, agent] of [[1, "p"], [2, "c"], [3, "p"], [4, "c"], [5, "p"]] as const) {
      assert.ok(judgeCall.text.includes(body(n, agent)), `judge sees full turn ${n}`);
    }
    assert.ok(!judgeCall.text.includes("[truncated"), "judge transcript is not compacted");
  });

  it("compactContext: false threads the full transcript between turns", async () => {
    const client = await run(false);
    const rebuttal = client.calls[4].text;
    for (const [n, agent] of [[1, "p"], [2, "c"], [3, "p"], [4, "c"]] as const) {
      assert.ok(rebuttal.includes(body(n, agent)), `uncompacted debate threads full turn ${n}`);
    }
    assert.ok(!rebuttal.includes("[truncated"), "no truncation when compaction is off");
  });
});
