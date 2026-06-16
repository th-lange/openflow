import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkflow, createAgent } from "../tools/management-tools.js";
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
