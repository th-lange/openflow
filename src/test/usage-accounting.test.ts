import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  extractUsage,
  formatUsageFooter,
  UsageLedger,
  ZERO_USAGE,
} from "../state/usage-ledger.js";
import { delegateTask } from "../tools/delegate-task.js";
import { runSequential } from "../tools/run-workflow.js";
import { clearAgentCache } from "../config/agent-registry.js";
import { DEFAULT_SETTINGS } from "../config/workflow-loader.js";
import type { SequentialWorkflow } from "../config/workflow-loader.js";
import { makeFakeClient } from "./fake-client.js";

const settings = DEFAULT_SETTINGS;

describe("extractUsage", () => {
  it("reads tokens, cache, cost, and model from an assistant message", () => {
    const { usage, model } = extractUsage({
      modelID: "claude-x",
      cost: 0.0123,
      tokens: { input: 100, output: 40, reasoning: 5, cache: { read: 80, write: 20 } },
    });
    assert.deepEqual(usage, {
      input: 100,
      output: 40,
      reasoning: 5,
      cacheRead: 80,
      cacheWrite: 20,
      cost: 0.0123,
    });
    assert.equal(model, "claude-x");
  });

  it("defaults to zero when info or fields are absent (no behavior change)", () => {
    assert.deepEqual(extractUsage(undefined).usage, ZERO_USAGE);
    assert.equal(extractUsage(undefined).model, undefined);
    assert.deepEqual(extractUsage({ tokens: { input: 10 } }).usage, {
      ...ZERO_USAGE,
      input: 10,
    });
  });
});

describe("UsageLedger", () => {
  it("aggregates totals across recorded steps", () => {
    const led = new UsageLedger();
    led.record("a", { input: 100, output: 40, reasoning: 0, cacheRead: 80, cacheWrite: 0, cost: 0.01 });
    led.record("b", { input: 200, output: 60, reasoning: 5, cacheRead: 20, cacheWrite: 0, cost: 0.02 });
    const t = led.total();
    assert.equal(t.input, 300);
    assert.equal(t.output, 100);
    assert.equal(t.reasoning, 5);
    assert.equal(t.cacheRead, 100);
    assert.equal(Number(t.cost.toFixed(2)), 0.03);
    assert.equal(led.steps.length, 2);
    assert.deepEqual(led.steps.map((s) => s.agent), ["a", "b"]);
  });
});

describe("formatUsageFooter", () => {
  it("returns empty string when nothing ran", () => {
    assert.equal(formatUsageFooter(new UsageLedger()), "");
  });

  it("shows tokens and step count; cache% and cost only when non-zero", () => {
    const led = new UsageLedger();
    led.record("a", { input: 1500, output: 500, reasoning: 0, cacheRead: 1500, cacheWrite: 0, cost: 0.04 });
    const footer = formatUsageFooter(led);
    assert.match(footer, /tokens: 1\.5k in \/ 500 out/);
    assert.match(footer, /cache 50% read/); // 1500 / (1500 input + 1500 cacheRead)
    assert.match(footer, /~\$0\.0400/);
    assert.match(footer, /· 1 step_/);
  });

  it("omits cache and cost when the provider reports none", () => {
    const led = new UsageLedger();
    led.record("a", { ...ZERO_USAGE, input: 10, output: 5 });
    led.record("b", { ...ZERO_USAGE, input: 10, output: 5 });
    const footer = formatUsageFooter(led);
    assert.doesNotMatch(footer, /cache/);
    assert.doesNotMatch(footer, /\$/);
    assert.match(footer, /2 steps/);
  });
});

describe("delegateTask usage capture", () => {
  afterEach(clearAgentCache);

  it("returns usage from the response and records it into the ledger", async () => {
    const client = makeFakeClient({
      agents: ["coder"],
      usage: () => ({ input: 100, output: 40, cacheRead: 80, cost: 0.01, model: "m1" }),
    });
    const led = new UsageLedger();
    const out = await delegateTask({ agent: "coder", prompt: "go" }, client, undefined, undefined, led);

    assert.equal(out.usage.input, 100);
    assert.equal(out.usage.output, 40);
    assert.equal(out.usage.cacheRead, 80);
    assert.equal(out.model, "m1");
    assert.equal(led.steps.length, 1);
    assert.equal(led.total().input, 100);
  });

  it("yields zero usage when the provider reports nothing", async () => {
    const client = makeFakeClient({ agents: ["coder"] });
    const out = await delegateTask({ agent: "coder", prompt: "go" }, client);
    assert.deepEqual(out.usage, ZERO_USAGE);
  });
});

describe("usage aggregation across a multi-step run", () => {
  afterEach(clearAgentCache);

  it("accumulates every step's usage into the run ledger", async () => {
    const client = makeFakeClient({
      agents: ["composer", "coder"],
      usage: (agent) =>
        agent === "composer"
          ? { input: 100, output: 50, cacheRead: 100, cost: 0.01 }
          : { input: 300, output: 80, cacheRead: 0, cost: 0.03 },
    });
    const wf: SequentialWorkflow = {
      pattern: "sequential",
      sequence: ["composer", "coder"],
      commanderMayAlsoUse: [],
    };
    const led = new UsageLedger();
    const noopDispatch = (() => Promise.resolve("")) as any;
    await runSequential(wf, "task", undefined, "sess", client, "/tmp", noopDispatch, settings, led);

    const t = led.total();
    assert.equal(led.steps.length, 2);
    assert.equal(t.input, 400);
    assert.equal(t.output, 130);
    assert.equal(t.cacheRead, 100);
    assert.equal(Number(t.cost.toFixed(2)), 0.04);
    assert.match(formatUsageFooter(led), /tokens: 400 in \/ 130 out · cache 20% read · ~\$0\.0400 · 2 steps/);
  });
});
