import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkflow, createAgent, enableWorkflow, disableWorkflow } from "../tools/management-tools.js";
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

let tmpDir = "";

async function setup(): Promise<string> {
  tmpDir = join(tmpdir(), `openflow-mgmt-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  clearAgentCache();
  return tmpDir;
}

async function teardown(): Promise<void> {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  clearAgentCache();
}

// ── create_workflow ───────────────────────────────────────────────────────────

describe("create_workflow", () => {
  afterEach(teardown);

  it("creates openflow.json when it does not exist", async () => {
    const dir = await setup();
    const client = makeClient(["composer", "coder"]);
    await createWorkflow({ name: "test", sequence: ["composer", "coder"] }, client, dir);
    const raw = await readFile(join(dir, "openflow.json"), "utf-8");
    const json = JSON.parse(raw);
    assert.deepEqual(json.workflows.test.sequence, ["composer", "coder"]);
  });

  it("defaults commanderMayAlsoUse to sequence", async () => {
    const dir = await setup();
    const client = makeClient(["coder"]);
    await createWorkflow({ name: "w", sequence: ["coder"] }, client, dir);
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.deepEqual(json.workflows.w.commanderMayAlsoUse, ["coder"]);
  });

  it("stores description when provided", async () => {
    const dir = await setup();
    const client = makeClient(["analyzer"]);
    await createWorkflow({ name: "w", sequence: ["analyzer"], description: "My workflow" }, client, dir);
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.equal(json.workflows.w.description, "My workflow");
  });

  it("rejects unknown agents", async () => {
    const dir = await setup();
    const client = makeClient(["coder"]);
    await assert.rejects(
      () => createWorkflow({ name: "w", sequence: ["ghost"] }, client, dir),
      /Unknown agent "ghost"/
    );
  });

  it("rejects duplicate workflow without force", async () => {
    const dir = await setup();
    const client = makeClient(["coder"]);
    await createWorkflow({ name: "w", sequence: ["coder"] }, client, dir);
    await assert.rejects(
      () => createWorkflow({ name: "w", sequence: ["coder"] }, client, dir),
      /already exists/
    );
  });

  it("overwrites with force=true", async () => {
    const dir = await setup();
    const client = makeClient(["coder", "analyzer"]);
    await createWorkflow({ name: "w", sequence: ["coder"] }, client, dir);
    await createWorkflow({ name: "w", sequence: ["analyzer"], force: true }, client, dir);
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.deepEqual(json.workflows.w.sequence, ["analyzer"]);
  });

  it("preserves existing workflows", async () => {
    const dir = await setup();
    const client = makeClient(["coder", "analyzer"]);
    await createWorkflow({ name: "a", sequence: ["coder"] }, client, dir);
    await createWorkflow({ name: "b", sequence: ["analyzer"] }, client, dir);
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.ok(json.workflows.a);
    assert.ok(json.workflows.b);
  });
});

// ── create_workflow — non-sequential patterns (#40) ───────────────────────────

describe("create_workflow — patterns", () => {
  afterEach(teardown);

  it("creates an evaluator-optimizer workflow", async () => {
    const dir = await setup();
    const client = makeClient(["coder", "analyzer"]);
    await createWorkflow(
      { name: "qi", pattern: "evaluator-optimizer", producer: "coder", evaluator: "analyzer", maxIterations: 4 },
      client,
      dir
    );
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.equal(json.workflows.qi.pattern, "evaluator-optimizer");
    assert.equal(json.workflows.qi.producer, "coder");
    assert.equal(json.workflows.qi.maxIterations, 4);
  });

  it("creates a fanout workflow", async () => {
    const dir = await setup();
    const client = makeClient(["coder", "analyzer"]);
    await createWorkflow(
      { name: "best3", pattern: "fanout", agents: ["coder", "coder", "coder"], picker: "analyzer" },
      client,
      dir
    );
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.equal(json.workflows.best3.pattern, "fanout");
    assert.equal(json.workflows.best3.agents.length, 3);
  });

  it("creates a conditional workflow referencing existing workflows", async () => {
    const dir = await setup();
    const client = makeClient(["composer", "coder", "analyzer"]);
    await createWorkflow({ name: "impl", sequence: ["coder"] }, client, dir);
    await createWorkflow({ name: "rev", sequence: ["analyzer"] }, client, dir);
    await createWorkflow(
      {
        name: "route",
        pattern: "conditional",
        router: "composer",
        routes: [
          { condition: "bug", workflow: "impl" },
          { condition: "review", workflow: "rev" },
        ],
        default: "impl",
      },
      client,
      dir
    );
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.equal(json.workflows.route.pattern, "conditional");
    assert.equal(json.workflows.route.routes.length, 2);
  });

  it("creates a sequential workflow with a checkpoint step", async () => {
    const dir = await setup();
    const client = makeClient(["composer", "coder"]);
    await createWorkflow(
      { name: "guarded", sequence: ["composer", { checkpoint: "approve?" }, "coder"] },
      client,
      dir
    );
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.deepEqual(json.workflows.guarded.sequence[1], { checkpoint: "approve?" });
  });

  it("rejects a malformed pattern and does not persist it", async () => {
    const dir = await setup();
    const client = makeClient(["coder"]);
    await assert.rejects(
      () => createWorkflow({ name: "bad", pattern: "evaluator-optimizer", producer: "coder" }, client, dir),
      /evaluator/
    );
    await assert.rejects(() => readFile(join(dir, "openflow.json"), "utf-8"));
  });

  it("rolls back a conditional with a dangling workflow reference", async () => {
    const dir = await setup();
    const client = makeClient(["composer", "coder"]);
    await createWorkflow({ name: "impl", sequence: ["coder"] }, client, dir);
    await assert.rejects(
      () =>
        createWorkflow(
          {
            name: "route",
            pattern: "conditional",
            router: "composer",
            routes: [{ condition: "x", workflow: "ghostwf" }],
            default: "impl",
          },
          client,
          dir
        ),
      /unknown workflow "ghostwf"/
    );
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.equal(json.workflows.route, undefined, "invalid workflow was not persisted");
    assert.ok(json.workflows.impl, "pre-existing workflow survived rollback");
  });
});

// ── create_agent ─────────────────────────────────────────────────────────────

describe("create_agent", () => {
  afterEach(teardown);

  it("creates opencode.json agent block when it does not exist", async () => {
    const dir = await setup();
    await createAgent({ name: "my-agent", prompt: "You are a test agent." }, dir);
    const json = JSON.parse(await readFile(join(dir, "opencode.json"), "utf-8"));
    assert.equal(json.agent["my-agent"].prompt, "You are a test agent.");
  });

  it("defaults mode to subagent", async () => {
    const dir = await setup();
    await createAgent({ name: "a", prompt: "p" }, dir);
    const json = JSON.parse(await readFile(join(dir, "opencode.json"), "utf-8"));
    assert.equal(json.agent.a.mode, "subagent");
  });

  it("sets edit/bash deny by default", async () => {
    const dir = await setup();
    await createAgent({ name: "a", prompt: "p" }, dir);
    const json = JSON.parse(await readFile(join(dir, "opencode.json"), "utf-8"));
    assert.equal(json.agent.a.permission.edit, "deny");
    assert.equal(json.agent.a.permission.bash, "deny");
  });

  it("sets edit/bash allow when flags are true", async () => {
    const dir = await setup();
    await createAgent({ name: "a", prompt: "p", allowEdit: true, allowBash: true }, dir);
    const json = JSON.parse(await readFile(join(dir, "opencode.json"), "utf-8"));
    assert.equal(json.agent.a.permission.edit, "allow");
    assert.equal(json.agent.a.permission.bash, "allow");
  });

  it("stores model when provided", async () => {
    const dir = await setup();
    await createAgent({ name: "a", prompt: "p", model: "anthropic/claude-haiku-4-5" }, dir);
    const json = JSON.parse(await readFile(join(dir, "opencode.json"), "utf-8"));
    assert.equal(json.agent.a.model, "anthropic/claude-haiku-4-5");
  });

  it("rejects duplicate agent without force", async () => {
    const dir = await setup();
    await createAgent({ name: "a", prompt: "p" }, dir);
    await assert.rejects(
      () => createAgent({ name: "a", prompt: "p2" }, dir),
      /already exists/
    );
  });

  it("overwrites with force=true", async () => {
    const dir = await setup();
    await createAgent({ name: "a", prompt: "original" }, dir);
    await createAgent({ name: "a", prompt: "updated", force: true }, dir);
    const json = JSON.parse(await readFile(join(dir, "opencode.json"), "utf-8"));
    assert.equal(json.agent.a.prompt, "updated");
  });

  it("preserves existing agents", async () => {
    const dir = await setup();
    await createAgent({ name: "a", prompt: "pa" }, dir);
    await createAgent({ name: "b", prompt: "pb" }, dir);
    const json = JSON.parse(await readFile(join(dir, "opencode.json"), "utf-8"));
    assert.ok(json.agent.a);
    assert.ok(json.agent.b);
  });
});

// ── JSONC handling (#35, #36) ─────────────────────────────────────────────────

describe("create_agent — JSONC config", () => {
  afterEach(teardown);

  it("writes into existing opencode.jsonc and does not create opencode.json", async () => {
    const dir = await setup();
    await writeFile(
      join(dir, "opencode.jsonc"),
      `{\n  // existing config\n  "agent": {\n    "keeper": { "mode": "subagent", "prompt": "keep me" }\n  }\n}\n`,
      "utf-8"
    );

    await createAgent({ name: "added", prompt: "new agent" }, dir);

    // No sibling opencode.json was created
    await assert.rejects(() => readFile(join(dir, "opencode.json"), "utf-8"));

    const raw = await readFile(join(dir, "opencode.jsonc"), "utf-8");
    // Comment is preserved
    assert.match(raw, /\/\/ existing config/);
    const json = JSON.parse(
      raw.replace(/\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1")
    );
    // Both the pre-existing agent and the new one are present
    assert.equal(json.agent.keeper.prompt, "keep me");
    assert.equal(json.agent.added.prompt, "new agent");
  });

  it("prefers opencode.jsonc over opencode.json when both exist", async () => {
    const dir = await setup();
    await writeFile(join(dir, "opencode.jsonc"), `{ "agent": {} }\n`, "utf-8");
    await writeFile(join(dir, "opencode.json"), `{ "agent": {} }\n`, "utf-8");

    await createAgent({ name: "a", prompt: "p" }, dir);

    const jsonc = JSON.parse(await readFile(join(dir, "opencode.jsonc"), "utf-8"));
    const json = JSON.parse(await readFile(join(dir, "opencode.json"), "utf-8"));
    assert.ok(jsonc.agent.a, "agent written to .jsonc");
    assert.equal(json.agent.a, undefined, ".json left untouched");
  });
});

describe("disable_workflow — comment preservation (#36)", () => {
  afterEach(teardown);

  it("preserves comments in openflow.json when toggling disabled", async () => {
    const dir = await setup();
    await writeFile(
      join(dir, "openflow.json"),
      `{\n  // keep this note\n  "workflows": {\n    "w": { "sequence": ["coder"] }\n  }\n}\n`,
      "utf-8"
    );

    await disableWorkflow("w", dir);

    const raw = await readFile(join(dir, "openflow.json"), "utf-8");
    assert.match(raw, /\/\/ keep this note/);
    const json = JSON.parse(raw.replace(/\/\/.*$/gm, ""));
    assert.equal(json.workflows.w.disabled, true);
    assert.deepEqual(json.workflows.w.sequence, ["coder"]);
  });
});

// ── enable_workflow / disable_workflow ────────────────────────────────────────

describe("disable_workflow", () => {
  afterEach(teardown);

  it("sets disabled=true on the workflow", async () => {
    const dir = await setup();
    const client = makeClient(["coder"]);
    await createWorkflow({ name: "w", sequence: ["coder"] }, client, dir);
    await disableWorkflow("w", dir);
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.equal(json.workflows.w.disabled, true);
  });

  it("is idempotent when workflow is already disabled", async () => {
    const dir = await setup();
    const client = makeClient(["coder"]);
    await createWorkflow({ name: "w", sequence: ["coder"] }, client, dir);
    await disableWorkflow("w", dir);
    await disableWorkflow("w", dir);
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.equal(json.workflows.w.disabled, true);
  });

  it("throws when workflow does not exist", async () => {
    const dir = await setup();
    await assert.rejects(() => disableWorkflow("ghost", dir), /not found/);
  });

  it("preserves other workflow fields", async () => {
    const dir = await setup();
    const client = makeClient(["coder", "analyzer"]);
    await createWorkflow({ name: "w", sequence: ["coder"], description: "my workflow" }, client, dir);
    await disableWorkflow("w", dir);
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.equal(json.workflows.w.description, "my workflow");
    assert.deepEqual(json.workflows.w.sequence, ["coder"]);
  });
});

describe("enable_workflow", () => {
  afterEach(teardown);

  it("removes the disabled flag", async () => {
    const dir = await setup();
    const client = makeClient(["coder"]);
    await createWorkflow({ name: "w", sequence: ["coder"] }, client, dir);
    await disableWorkflow("w", dir);
    await enableWorkflow("w", dir);
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.equal(json.workflows.w.disabled, undefined);
  });

  it("is idempotent when workflow is already enabled", async () => {
    const dir = await setup();
    const client = makeClient(["coder"]);
    await createWorkflow({ name: "w", sequence: ["coder"] }, client, dir);
    await enableWorkflow("w", dir);
    const json = JSON.parse(await readFile(join(dir, "openflow.json"), "utf-8"));
    assert.equal(json.workflows.w.disabled, undefined);
  });

  it("throws when workflow does not exist", async () => {
    const dir = await setup();
    await assert.rejects(() => enableWorkflow("ghost", dir), /not found/);
  });
});
