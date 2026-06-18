import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getWorkflow,
  listWorkflows,
  isValidWorkflow,
} from "../tools/workflow-tools.js";
import { loadWorkflows } from "../config/workflow-loader.js";
import { clearAgentCache } from "../config/agent-registry.js";
import type { OpencodeClient } from "@opencode-ai/sdk";

function makeClient(agentNames: string[]): OpencodeClient {
  return {
    app: {
      agents: () =>
        Promise.resolve({
          data: agentNames.map((name) => ({ name, mode: "subagent" })) as any,
          error: undefined,
        }),
    },
  } as unknown as OpencodeClient;
}

let dir = "";
async function seed(config: unknown): Promise<string> {
  dir = join(tmpdir(), `openflow-wt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "openflow.json"), JSON.stringify(config), "utf-8");
  clearAgentCache();
  return dir;
}
async function teardown() {
  if (dir) await rm(dir, { recursive: true, force: true });
  clearAgentCache();
}

describe("getWorkflow", () => {
  afterEach(teardown);

  it("parses a workflow and attaches its name", async () => {
    const d = await seed({
      workflows: { feature: { sequence: ["composer", "coder", "analyzer"] } },
    });
    const wf = await getWorkflow("feature", d);
    assert.equal(wf.name, "feature");
    assert.equal(wf.pattern, "sequential");
    assert.deepEqual((wf as any).sequence, ["composer", "coder", "analyzer"]);
  });

  it("agrees with loadWorkflows on the same entry (#38)", async () => {
    const d = await seed({
      workflows: {
        qi: { pattern: "evaluator-optimizer", producer: "coder", evaluator: "analyzer" },
      },
    });
    const viaTool = await getWorkflow("qi", d);
    const registry = await loadWorkflows(makeClient(["coder", "analyzer"]), d);
    const { name, ...toolParsed } = viaTool;
    assert.deepEqual(toolParsed, registry["qi"]);
  });

  it("throws not-found with an available list", async () => {
    const d = await seed({ workflows: { a: { sequence: ["coder"] } } });
    await assert.rejects(() => getWorkflow("ghost", d), /not found.*Available: a/s);
  });

  it("throws when the workflow is disabled", async () => {
    const d = await seed({ workflows: { a: { sequence: ["coder"], disabled: true } } });
    await assert.rejects(() => getWorkflow("a", d), /disabled/);
  });

  it("throws when the entry is malformed (same parser as the loader)", async () => {
    const d = await seed({ workflows: { bad: { sequence: [] } } });
    await assert.rejects(() => getWorkflow("bad", d), /non-empty "sequence"/);
  });
});

describe("listWorkflows", () => {
  afterEach(teardown);

  it("excludes disabled by default and includes them on request", async () => {
    const d = await seed({
      workflows: {
        a: { sequence: ["coder"] },
        b: { sequence: ["analyzer"], disabled: true },
      },
    });
    const visible = await listWorkflows(d);
    assert.deepEqual(visible.map((w) => w.name).sort(), ["a"]);

    const all = await listWorkflows(d, true);
    assert.deepEqual(all.map((w) => w.name).sort(), ["a", "b"]);
  });

  it("surfaces a malformed entry as invalid instead of throwing", async () => {
    const d = await seed({
      workflows: {
        good: { sequence: ["coder"] },
        broken: { pattern: "fanout" }, // missing agents/picker
      },
    });
    const list = await listWorkflows(d);
    const broken = list.find((w) => w.name === "broken");
    const good = list.find((w) => w.name === "good");
    assert.ok(good && isValidWorkflow(good), "good entry parses");
    assert.ok(broken && !isValidWorkflow(broken), "broken entry flagged invalid");
    assert.match((broken as any).error, /fan-?out/i);
  });

  it("returns an empty list when openflow.json is missing", async () => {
    const list = await listWorkflows(join(tmpdir(), "openflow-wt-missing-xyz"));
    assert.deepEqual(list, []);
  });
});
