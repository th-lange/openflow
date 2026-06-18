import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runSequential } from "../tools/run-workflow.js";
import { runEvaluatorOptimizer } from "../tools/run-evaluator-optimizer.js";
import { runFanout } from "../tools/run-fanout.js";
import { runParallel } from "../tools/run-parallel.js";
import { runDebate } from "../tools/run-debate.js";
import { runConditional } from "../tools/run-conditional.js";
import { clearAgentCache } from "../config/agent-registry.js";
import { DEFAULT_SETTINGS } from "../config/workflow-loader.js";
import type {
  SequentialWorkflow,
  EvaluatorOptimizerWorkflow,
  FanoutWorkflow,
  ParallelWorkflow,
  DebateWorkflow,
  ConditionalWorkflow,
} from "../config/workflow-loader.js";
import { makeFakeClient } from "./fake-client.js";

const settings = DEFAULT_SETTINGS;

// A dispatch stub for runners that recurse into nested workflows. Records the
// names it was asked to run so tests can assert on routing/composition.
function recordingDispatch() {
  const seen: string[] = [];
  const fn = (name: string) => {
    seen.push(name);
    return Promise.resolve(`dispatched:${name}`);
  };
  return { fn: fn as any, seen };
}

describe("runSequential", () => {
  afterEach(clearAgentCache);

  it("runs steps in order and threads each output into the next step's context", async () => {
    const client = makeFakeClient({
      agents: ["composer", "coder"],
      respond: (agent, text) => `${agent} saw:[${text.includes("composer saw") ? "prior" : "none"}]`,
    });
    const wf: SequentialWorkflow = {
      pattern: "sequential",
      sequence: ["composer", "coder"],
      commanderMayAlsoUse: [],
    };
    const { fn } = recordingDispatch();
    const out = await runSequential(wf, "task", undefined, "sess", client, "/tmp", fn, settings);

    // composer ran first with no prior context; coder's prompt carried composer's output
    assert.equal(client.calls[0].agent, "composer");
    assert.equal(client.calls[1].agent, "coder");
    assert.match(client.calls[1].text, /composer saw/);
    assert.match(out, /Workflow complete/);
    assert.match(out, /Step 1\/2 — composer/);
    assert.match(out, /Step 2\/2 — coder/);
  });

  it("delegates nested { workflow } steps to the dispatcher", async () => {
    const client = makeFakeClient({ agents: ["composer"], respond: (a) => `${a}-out` });
    const wf: SequentialWorkflow = {
      pattern: "sequential",
      sequence: ["composer", { workflow: "sub" }],
      commanderMayAlsoUse: [],
    };
    const { fn, seen } = recordingDispatch();
    const out = await runSequential(wf, "task", undefined, "sess", client, "/tmp", fn, settings);
    assert.deepEqual(seen, ["sub"]);
    assert.match(out, /dispatched:sub/);
  });
});

describe("runEvaluatorOptimizer", () => {
  afterEach(clearAgentCache);

  it("stops when the evaluator returns a PASS verdict", async () => {
    const client = makeFakeClient({
      agents: ["producer", "evaluator"],
      respond: (agent) =>
        agent === "producer"
          ? "draft"
          : 'looks good\n```openflow\n{"verdict":"PASS","feedback":""}\n```',
    });
    const wf: EvaluatorOptimizerWorkflow = {
      pattern: "evaluator-optimizer",
      producer: "producer",
      evaluator: "evaluator",
      maxIterations: 3,
      passCriteria: "PASS",
    };
    const out = await runEvaluatorOptimizer(wf, "task", undefined, "sess", client, settings);
    assert.match(out, /passed on iteration 1\/3/);
    // one producer + one evaluator call
    assert.equal(client.calls.filter((c) => c.agent === "producer").length, 1);
  });

  it("exhausts iterations and threads evaluator feedback back to the producer", async () => {
    const client = makeFakeClient({
      agents: ["producer", "evaluator"],
      respond: (agent) =>
        agent === "producer"
          ? "draft"
          : 'needs work\n```openflow\n{"verdict":"FAIL","feedback":"add tests"}\n```',
    });
    const wf: EvaluatorOptimizerWorkflow = {
      pattern: "evaluator-optimizer",
      producer: "producer",
      evaluator: "evaluator",
      maxIterations: 2,
      passCriteria: "PASS",
    };
    const out = await runEvaluatorOptimizer(wf, "task", undefined, "sess", client, settings);
    assert.match(out, /exhausted/);
    const producerCalls = client.calls.filter((c) => c.agent === "producer");
    assert.equal(producerCalls.length, 2);
    // second producer call received the evaluator's feedback as context
    assert.match(producerCalls[1].text, /add tests/);
  });
});

describe("runFanout", () => {
  afterEach(clearAgentCache);

  it("dispatches all agents and returns the picker's chosen candidate", async () => {
    const client = makeFakeClient({
      agents: ["a", "b", "c", "picker"],
      respond: (agent) =>
        agent === "picker"
          ? 'choosing\n```openflow\n{"choice":2,"reason":"best"}\n```'
          : `${agent}-candidate`,
    });
    const wf: FanoutWorkflow = { pattern: "fanout", agents: ["a", "b", "c"], picker: "picker" };
    const out = await runFanout(wf, "task", undefined, "sess", client, settings);
    assert.match(out, /3\/3 agents succeeded, picker chose candidate 2/);
    assert.match(out, /## Selected output \(b\)/);
    assert.match(out, /b-candidate/);
  });

  it("excludes failed agents and still picks from survivors", async () => {
    const client = makeFakeClient({
      agents: ["a", "b", "picker"],
      respond: (agent) => {
        if (agent === "b") throw new Error("b failed");
        if (agent === "picker") return '```openflow\n{"choice":1}\n```';
        return `${agent}-candidate`;
      },
    });
    const wf: FanoutWorkflow = { pattern: "fanout", agents: ["a", "b"], picker: "picker" };
    const out = await runFanout(wf, "task", undefined, "sess", client, settings);
    assert.match(out, /1\/2 agents succeeded/);
    assert.match(out, /a-candidate/);
  });

  it("throws when every fan-out agent fails", async () => {
    const client = makeFakeClient({
      agents: ["a", "b", "picker"],
      respond: (agent) => {
        if (agent === "picker") return "unused";
        throw new Error(`${agent} failed`);
      },
    });
    const wf: FanoutWorkflow = { pattern: "fanout", agents: ["a", "b"], picker: "picker" };
    await assert.rejects(
      runFanout(wf, "task", undefined, "sess", client, settings),
      /All 2 fan-out agents failed/
    );
  });
});

describe("runParallel", () => {
  afterEach(clearAgentCache);

  it("runs subtasks and consolidates via the merger", async () => {
    const client = makeFakeClient({
      agents: ["a", "b", "merger"],
      respond: (agent) => (agent === "merger" ? "MERGED" : `${agent}-out`),
    });
    const wf: ParallelWorkflow = {
      pattern: "parallel",
      subtasks: [
        { agent: "a", prompt: "p1" },
        { agent: "b", prompt: "p2" },
      ],
      merger: "merger",
    };
    const out = await runParallel(wf, "task", undefined, "sess", client, settings);
    assert.match(out, /2\/2 subtasks succeeded/);
    assert.match(out, /MERGED/);
  });

  it("notes failed subtasks but still merges the survivors", async () => {
    const client = makeFakeClient({
      agents: ["a", "b", "merger"],
      respond: (agent) => {
        if (agent === "b") throw new Error("b broke");
        return agent === "merger" ? "MERGED" : `${agent}-out`;
      },
    });
    const wf: ParallelWorkflow = {
      pattern: "parallel",
      subtasks: [
        { agent: "a", prompt: "p1" },
        { agent: "b", prompt: "p2" },
      ],
      merger: "merger",
    };
    const out = await runParallel(wf, "task", undefined, "sess", client, settings);
    assert.match(out, /1\/2 subtasks succeeded/);
    // merger context flagged the failure
    const mergerCall = client.calls.find((c) => c.agent === "merger")!;
    assert.match(mergerCall.text, /FAILED/);
  });
});

describe("runDebate", () => {
  afterEach(clearAgentCache);

  it("runs the right number of turns and parses the judge's decision", async () => {
    const client = makeFakeClient({
      agents: ["proposer", "critic", "judge"],
      respond: (agent) =>
        agent === "judge"
          ? 'verdict\n```openflow\n{"decision":"adopt","reason":"sound"}\n```'
          : `${agent} speaks`,
    });
    const wf: DebateWorkflow = {
      pattern: "debate",
      proposer: "proposer",
      critic: "critic",
      judge: "judge",
      rounds: 2,
    };
    const out = await runDebate(wf, "task", undefined, "sess", client, settings);
    assert.match(out, /judge decision: \*\*adopt\*\*/);
    // initial(1) + r1 critic+proposer(2) + r2 critic(1) + rebuttal(1) + judge(1) = 6
    assert.equal(client.calls.length, 6);
    assert.equal(client.calls.filter((c) => c.agent === "judge").length, 1);
  });
});

describe("runConditional", () => {
  afterEach(clearAgentCache);

  it("routes to the workflow matching the router's choice", async () => {
    const client = makeFakeClient({
      agents: ["router"],
      respond: () => 'classifying\n```openflow\n{"route":"bug"}\n```',
    });
    const wf: ConditionalWorkflow = {
      pattern: "conditional",
      router: "router",
      routes: [
        { condition: "bug", workflow: "fix" },
        { condition: "feature", workflow: "build" },
      ],
      default: "build",
    };
    const { fn, seen } = recordingDispatch();
    const out = await runConditional(wf, "task", undefined, "sess", client, "/tmp", fn, settings);
    assert.deepEqual(seen, ["fix"]);
    assert.match(out, /Routing → fix \(matched: "bug"\)/);
    assert.match(out, /dispatched:fix/);
  });

  it("falls back to the default workflow when no route matches", async () => {
    const client = makeFakeClient({
      agents: ["router"],
      respond: () => '```openflow\n{"route":"unknown"}\n```',
    });
    const wf: ConditionalWorkflow = {
      pattern: "conditional",
      router: "router",
      routes: [{ condition: "bug", workflow: "fix" }],
      default: "build",
    };
    const { fn, seen } = recordingDispatch();
    const out = await runConditional(wf, "task", undefined, "sess", client, "/tmp", fn, settings);
    assert.deepEqual(seen, ["build"]);
    assert.match(out, /Using default: build/);
  });
});
