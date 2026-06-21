import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseWorkflowEntry, DEFAULT_SETTINGS } from "../config/workflow-loader.js";
import type { SequentialWorkflow } from "../config/workflow-loader.js";
import { runSequential } from "../tools/run-workflow.js";
import { clearAgentCache } from "../config/agent-registry.js";
import { makeFakeClient } from "./fake-client.js";

const settings = DEFAULT_SETTINGS;
const noopDispatch = (() => Promise.resolve("")) as any;

describe("contextScope parsing", () => {
  it("accepts all | last | none", () => {
    for (const scope of ["all", "last", "none"] as const) {
      const w = parseWorkflowEntry("x", { sequence: ["a"], contextScope: scope }) as SequentialWorkflow;
      assert.equal(w.contextScope, scope);
    }
  });

  it("leaves contextScope undefined when omitted (default applied at runtime)", () => {
    const w = parseWorkflowEntry("x", { sequence: ["a"] }) as SequentialWorkflow;
    assert.equal(w.contextScope, undefined);
  });

  it("rejects an unknown contextScope value", () => {
    assert.throws(
      () => parseWorkflowEntry("x", { sequence: ["a"], contextScope: "everything" }),
      /contextScope.*must be one of all, last, none/
    );
  });

  it("accepts a boolean compactContext and rejects non-booleans", () => {
    const w = parseWorkflowEntry("x", { sequence: ["a"], compactContext: false }) as SequentialWorkflow;
    assert.equal(w.compactContext, false);
    assert.equal((parseWorkflowEntry("x", { sequence: ["a"] }) as SequentialWorkflow).compactContext, undefined);
    assert.throws(
      () => parseWorkflowEntry("x", { sequence: ["a"], compactContext: "yes" }),
      /compactContext.*must be a boolean/
    );
  });
});

describe("contextScope threading in runSequential", () => {
  afterEach(clearAgentCache);

  function clientFor() {
    return makeFakeClient({ agents: ["a", "b", "c"], respond: (agent) => `${agent}-out` });
  }

  const seq = (contextScope?: "all" | "last" | "none"): SequentialWorkflow => ({
    pattern: "sequential",
    sequence: ["a", "b", "c"],
    commanderMayAlsoUse: [],
    ...(contextScope ? { contextScope } : {}),
  });

  it("default (all): the last step sees every prior step output", async () => {
    const client = clientFor();
    await runSequential(seq(), "task", undefined, "sess", client, "/tmp", noopDispatch, settings);
    const cText = client.calls[2].text; // step c
    assert.match(cText, /Step 1 — a/);
    assert.match(cText, /Step 2 — b/);
  });

  it("last: the last step sees only the immediately preceding step", async () => {
    const client = clientFor();
    await runSequential(seq("last"), "task", undefined, "sess", client, "/tmp", noopDispatch, settings);
    const cText = client.calls[2].text;
    assert.doesNotMatch(cText, /Step 1 — a/);
    assert.match(cText, /Step 2 — b/);
  });

  it("none: steps see no prior-step context at all", async () => {
    const client = clientFor();
    await runSequential(seq("none"), "task", undefined, "sess", client, "/tmp", noopDispatch, settings);
    // No step after the first receives a "Prior step results" block
    assert.doesNotMatch(client.calls[1].text, /Prior step results/);
    assert.doesNotMatch(client.calls[2].text, /Prior step results/);
  });

  it("first step never carries prior-step context regardless of scope", async () => {
    for (const scope of [undefined, "last", "none"] as const) {
      const client = clientFor();
      await runSequential(seq(scope), "task", undefined, "sess", client, "/tmp", noopDispatch, settings);
      assert.doesNotMatch(client.calls[0].text, /Prior step results/);
    }
  });
});
