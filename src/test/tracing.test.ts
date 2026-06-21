import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTracer, NOOP_TRACER } from "../tracing/tracer.js";
import { UsageLedger, ZERO_USAGE } from "../state/usage-ledger.js";
import { runSequential } from "../tools/run-workflow.js";
import { runEvaluatorOptimizer } from "../tools/run-evaluator-optimizer.js";
import { clearAgentCache } from "../config/agent-registry.js";
import { DEFAULT_SETTINGS } from "../config/workflow-loader.js";
import type { SequentialWorkflow, EvaluatorOptimizerWorkflow } from "../config/workflow-loader.js";
import { makeFakeClient } from "./fake-client.js";

const settings = DEFAULT_SETTINGS;
const noopDispatch = (() => Promise.resolve("")) as any;

function recordingTrace() {
  const generations: any[] = [];
  return { trace: { generation: (d: any) => generations.push(d) }, generations };
}

describe("createTracer", () => {
  const saved = {
    pk: process.env["LANGFUSE_PUBLIC_KEY"],
    sk: process.env["LANGFUSE_SECRET_KEY"],
  };
  beforeEach(() => {
    delete process.env["LANGFUSE_PUBLIC_KEY"];
    delete process.env["LANGFUSE_SECRET_KEY"];
  });
  afterEach(() => {
    if (saved.pk === undefined) delete process.env["LANGFUSE_PUBLIC_KEY"];
    else process.env["LANGFUSE_PUBLIC_KEY"] = saved.pk;
    if (saved.sk === undefined) delete process.env["LANGFUSE_SECRET_KEY"];
    else process.env["LANGFUSE_SECRET_KEY"] = saved.sk;
  });

  it("returns the no-op tracer when tracing is disabled", async () => {
    assert.equal(await createTracer(undefined), NOOP_TRACER);
    assert.equal(await createTracer({ enabled: false }), NOOP_TRACER);
  });

  it("returns the no-op tracer when enabled but API keys are absent", async () => {
    assert.equal(await createTracer({ enabled: true }), NOOP_TRACER);
  });

  it("degrades to the no-op tracer when the langfuse package is not installed", async () => {
    process.env["LANGFUSE_PUBLIC_KEY"] = "pk";
    process.env["LANGFUSE_SECRET_KEY"] = "sk";
    // langfuse is not a dependency in this repo, so the dynamic import fails and
    // tracing degrades rather than throwing.
    assert.equal(await createTracer({ enabled: true }), NOOP_TRACER);
  });

  it("the no-op tracer never throws and flush resolves", async () => {
    const t = NOOP_TRACER;
    const trace = t.trace("x", { a: 1 });
    trace.generation({ name: "a", usage: { input: 0, output: 0, total: 0, cost: 0 } });
    trace.end();
    await t.flush();
  });
});

describe("UsageLedger trace forwarding", () => {
  it("emits a generation with model, usage total, and per-call detail", () => {
    const { trace, generations } = recordingTrace();
    const led = new UsageLedger(trace);
    led.record(
      "coder",
      { ...ZERO_USAGE, input: 10, output: 5, cost: 0.01 },
      "m1",
      { input: "the prompt", output: "the result" }
    );
    assert.equal(generations.length, 1);
    assert.equal(generations[0].name, "coder");
    assert.equal(generations[0].model, "m1");
    assert.equal(generations[0].usage.total, 15);
    assert.equal(generations[0].usage.cost, 0.01);
    assert.equal(generations[0].input, "the prompt");
    assert.equal(generations[0].output, "the result");
  });

  it("records normally with no trace attached", () => {
    const led = new UsageLedger();
    led.record("a", { ...ZERO_USAGE, input: 1 });
    assert.equal(led.steps.length, 1);
  });
});

describe("tracing through a run", () => {
  afterEach(clearAgentCache);

  it("emits one generation per step in a sequential run, with input/output", async () => {
    const client = makeFakeClient({
      agents: ["a", "b"],
      usage: () => ({ input: 10, output: 5, cost: 0.01 }),
    });
    const { trace, generations } = recordingTrace();
    const wf: SequentialWorkflow = { pattern: "sequential", sequence: ["a", "b"], commanderMayAlsoUse: [] };
    await runSequential(wf, "task", undefined, "sess", client, "/tmp", noopDispatch, settings, new UsageLedger(trace));

    assert.deepEqual(generations.map((g) => g.name), ["a", "b"]);
    assert.ok(generations.every((g) => g.input && g.output), "each generation has input + output");
    assert.ok(generations.every((g) => g.startTime instanceof Date && g.endTime instanceof Date), "timing captured");
  });

  it("emits a generation per delegation in a multi-step pattern", async () => {
    const client = makeFakeClient({
      agents: ["producer", "evaluator"],
      respond: (agent) =>
        agent === "evaluator" ? '```openflow\n{"verdict":"PASS","feedback":""}\n```' : "produced",
    });
    const { trace, generations } = recordingTrace();
    const wf: EvaluatorOptimizerWorkflow = {
      pattern: "evaluator-optimizer",
      producer: "producer",
      evaluator: "evaluator",
      maxIterations: 3,
      passCriteria: "PASS",
    };
    await runEvaluatorOptimizer(wf, "task", undefined, "sess", client, settings, new UsageLedger(trace));
    // Passes on iteration 1 → producer + evaluator
    assert.deepEqual(generations.map((g) => g.name), ["producer", "evaluator"]);
  });
});
