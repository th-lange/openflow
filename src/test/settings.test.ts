import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  mergeSettings,
  resolveSettings,
  loadWorkflows,
  DEFAULT_SETTINGS,
} from "../config/workflow-loader.js";
import { clearAgentCache } from "../config/agent-registry.js";
import { makeFakeClient } from "./fake-client.js";

// Guard env-override tests so they never leak state between cases.
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe("mergeSettings", () => {
  it("returns defaults when no block is given", () => {
    assert.deepEqual(mergeSettings(undefined), DEFAULT_SETTINGS);
  });

  it("applies a valid settings block", () => {
    assert.deepEqual(mergeSettings({ agentTimeoutMs: 1000, maxConcurrent: 2 }), {
      agentTimeoutMs: 1000,
      maxConcurrent: 2,
    });
  });

  it("merges partial blocks over defaults", () => {
    assert.deepEqual(mergeSettings({ maxConcurrent: 8 }), {
      agentTimeoutMs: DEFAULT_SETTINGS.agentTimeoutMs,
      maxConcurrent: 8,
    });
  });

  it("rejects a non-object settings block", () => {
    assert.throws(() => mergeSettings(42), /"settings" must be an object/);
    assert.throws(() => mergeSettings([]), /"settings" must be an object/);
  });

  it("rejects a non-positive timeout", () => {
    assert.throws(() => mergeSettings({ agentTimeoutMs: 0 }), /agentTimeoutMs/);
    assert.throws(() => mergeSettings({ agentTimeoutMs: -5 }), /agentTimeoutMs/);
    assert.throws(() => mergeSettings({ agentTimeoutMs: "100" }), /agentTimeoutMs/);
  });

  it("rejects a non-integer or non-positive concurrency", () => {
    assert.throws(() => mergeSettings({ maxConcurrent: 2.5 }), /maxConcurrent/);
    assert.throws(() => mergeSettings({ maxConcurrent: 0 }), /maxConcurrent/);
  });

  it("lets environment variables override the file", () => {
    withEnv({ OPENFLOW_AGENT_TIMEOUT_MS: "12345", OPENFLOW_MAX_CONCURRENT: "9" }, () => {
      assert.deepEqual(mergeSettings({ agentTimeoutMs: 1000, maxConcurrent: 2 }), {
        agentTimeoutMs: 12345,
        maxConcurrent: 9,
      });
    });
  });

  it("rejects malformed environment overrides", () => {
    withEnv({ OPENFLOW_MAX_CONCURRENT: "lots" }, () => {
      assert.throws(() => mergeSettings(undefined), /OPENFLOW_MAX_CONCURRENT/);
    });
  });
});

describe("resolveSettings / loadWorkflows", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
    clearAgentCache();
  });

  async function setup(json: unknown): Promise<string> {
    dir = join(tmpdir(), `openflow-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "openflow.json"), JSON.stringify(json), "utf-8");
    return dir;
  }

  it("reads a settings block from openflow.json", async () => {
    const d = await setup({ settings: { agentTimeoutMs: 7000, maxConcurrent: 3 }, workflows: {} });
    assert.deepEqual(await resolveSettings(d), { agentTimeoutMs: 7000, maxConcurrent: 3 });
  });

  it("returns defaults when openflow.json is absent", async () => {
    const empty = join(tmpdir(), `openflow-none-${Date.now()}`);
    assert.deepEqual(await resolveSettings(empty), DEFAULT_SETTINGS);
  });

  it("rejects a bad settings block at load time", async () => {
    const d = await setup({ settings: { maxConcurrent: -1 }, workflows: {} });
    const client = makeFakeClient({ agents: [] });
    await assert.rejects(loadWorkflows(client, d), /maxConcurrent/);
  });
});
