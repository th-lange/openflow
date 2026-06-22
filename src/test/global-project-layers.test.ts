import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { OpencodeClient } from "@opencode-ai/sdk";
import {
  resolveWorkflowMaps,
  resolveSettings,
  resolveUserAgents,
  loadWorkflows,
} from "../config/workflow-loader.js";
import { getWorkflow, listWorkflows } from "../tools/workflow-tools.js";
import { clearAgentCache } from "../config/agent-registry.js";

// Global + project layering (#82). The global dir is pointed at a temp dir per
// test via OPENFLOW_GLOBAL_DIR, overriding the empty default from setup.ts.

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

let globalDir: string;
let projectDir: string;
const savedGlobal = process.env["OPENFLOW_GLOBAL_DIR"];

async function writeOpenflow(dir: string, obj: unknown): Promise<void> {
  await writeFile(resolve(dir, "openflow.json"), JSON.stringify(obj), "utf-8");
}

beforeEach(async () => {
  globalDir = await mkdtemp(resolve(tmpdir(), "of-global-"));
  projectDir = await mkdtemp(resolve(tmpdir(), "of-project-"));
  process.env["OPENFLOW_GLOBAL_DIR"] = globalDir;
  clearAgentCache();
});

afterEach(async () => {
  process.env["OPENFLOW_GLOBAL_DIR"] = savedGlobal;
  await rm(globalDir, { recursive: true, force: true });
  await rm(projectDir, { recursive: true, force: true });
  clearAgentCache();
});

describe("resolveWorkflowMaps (global + project)", () => {
  it("merges both layers and tags origin", async () => {
    await writeOpenflow(globalDir, { workflows: { shared: { sequence: ["coder"] } } });
    await writeOpenflow(projectDir, { workflows: { local: { sequence: ["analyzer"] } } });

    const { merged, origin } = await resolveWorkflowMaps(projectDir);
    assert.deepEqual(Object.keys(merged).sort(), ["local", "shared"]);
    assert.equal(origin["shared"], "global");
    assert.equal(origin["local"], "project");
  });

  it("global wins on a name collision (project cannot shadow)", async () => {
    await writeOpenflow(globalDir, {
      workflows: { feature: { description: "global", sequence: ["coder"] } },
    });
    await writeOpenflow(projectDir, {
      workflows: { feature: { description: "project", sequence: ["analyzer"] } },
    });

    const { merged, origin } = await resolveWorkflowMaps(projectDir);
    assert.equal(origin["feature"], "global");
    assert.equal((merged["feature"] as { description: string }).description, "global");
  });

  it("project-only workflow resolves when no global file exists", async () => {
    await writeOpenflow(projectDir, { workflows: { only: { sequence: ["coder"] } } });
    const { merged, origin } = await resolveWorkflowMaps(projectDir);
    assert.deepEqual(Object.keys(merged), ["only"]);
    assert.equal(origin["only"], "project");
  });

  it("global-only workflow is available with no project file", async () => {
    await writeOpenflow(globalDir, { workflows: { base: { sequence: ["coder"] } } });
    const { merged, origin } = await resolveWorkflowMaps(projectDir);
    assert.deepEqual(Object.keys(merged), ["base"]);
    assert.equal(origin["base"], "global");
  });
});

describe("getWorkflow / listWorkflows across layers", () => {
  it("getWorkflow finds a global workflow from a project dir", async () => {
    await writeOpenflow(globalDir, { workflows: { base: { sequence: ["coder"] } } });
    const wf = await getWorkflow("base", projectDir);
    assert.equal(wf.name, "base");
    assert.equal(wf.origin, "global");
  });

  it("listWorkflows shows the merged set with origins", async () => {
    await writeOpenflow(globalDir, { workflows: { shared: { sequence: ["coder"] } } });
    await writeOpenflow(projectDir, { workflows: { local: { sequence: ["analyzer"] } } });
    const list = await listWorkflows(projectDir);
    const byName = Object.fromEntries(list.map((w) => [w.name, w.origin]));
    assert.deepEqual(byName, { shared: "global", local: "project" });
  });
});

describe("loadWorkflows validates the merged registry", () => {
  it("accepts a project workflow that references a global workflow", async () => {
    await writeOpenflow(globalDir, { workflows: { base: { sequence: ["coder"] } } });
    await writeOpenflow(projectDir, {
      workflows: { wrap: { sequence: [{ workflow: "base" }, "analyzer"] } },
    });
    const registry = await loadWorkflows(makeClient(["coder", "analyzer"]), projectDir);
    assert.deepEqual(Object.keys(registry).sort(), ["base", "wrap"]);
  });

  it("global wins in the built registry on a collision", async () => {
    await writeOpenflow(globalDir, { workflows: { feature: { sequence: ["coder"] } } });
    await writeOpenflow(projectDir, { workflows: { feature: { sequence: ["analyzer", "coder"] } } });
    const registry = await loadWorkflows(makeClient(["coder", "analyzer"]), projectDir);
    assert.deepEqual((registry["feature"] as any).sequence, ["coder"]);
  });
});

describe("resolveSettings layering (project over global)", () => {
  it("project overrides global per key; global fills the rest", async () => {
    await writeOpenflow(globalDir, { settings: { agentTimeoutMs: 111, maxConcurrent: 9 } });
    await writeOpenflow(projectDir, { settings: { maxConcurrent: 3 } });
    const settings = await resolveSettings(projectDir);
    assert.equal(settings.agentTimeoutMs, 111); // from global
    assert.equal(settings.maxConcurrent, 3); // project wins
  });
});

describe("resolveUserAgents layering (global wins)", () => {
  it("merges agents from both layers, global winning on a collision", async () => {
    await writeOpenflow(globalDir, {
      agents: { shared: { mode: "subagent", prompt: "global" } },
    });
    await writeOpenflow(projectDir, {
      agents: {
        shared: { mode: "subagent", prompt: "project" },
        local: { mode: "subagent", prompt: "local" },
      },
    });
    const agents = await resolveUserAgents(projectDir);
    assert.deepEqual(Object.keys(agents).sort(), ["local", "shared"]);
    assert.equal((agents["shared"] as { prompt: string }).prompt, "global");
  });
});
