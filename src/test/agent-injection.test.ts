import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  mergeInjectables,
  loadUserAgents,
  loadBuiltins,
  type Injectables,
} from "../config/agent-injector.js";
import { validateAgents } from "../config/workflow-loader.js";

const builtins: Injectables = {
  agent: {
    commander: { mode: "primary", prompt: "built-in" },
    coder: { mode: "subagent", prompt: "built-in" },
  },
  command: {
    workflow: { template: "Run workflow: $ARGUMENTS", agent: "commander" },
  },
};

describe("mergeInjectables", () => {
  it("adds built-in agents and commands into an empty config", () => {
    const config: { agent?: Record<string, unknown>; command?: Record<string, unknown> } = {};
    const added = mergeInjectables(config, builtins, {});
    assert.deepEqual(Object.keys(config.agent!).sort(), ["coder", "commander"]);
    assert.deepEqual(Object.keys(config.command!), ["workflow"]);
    assert.deepEqual(added.agents.sort(), ["coder", "commander"]);
    assert.deepEqual(added.commands, ["workflow"]);
  });

  it("never clobbers an agent or command already present in the host config", () => {
    const config = {
      agent: { coder: { mode: "subagent", prompt: "user-override" } },
      command: { workflow: { template: "custom", agent: "commander" } },
    };
    const added = mergeInjectables(config, builtins, {});
    // Existing definitions are preserved verbatim.
    assert.equal((config.agent.coder as { prompt: string }).prompt, "user-override");
    assert.equal((config.command.workflow as { template: string }).template, "custom");
    // Only the genuinely new built-in is reported as added.
    assert.deepEqual(added.agents, ["commander"]);
    assert.deepEqual(added.commands, []);
  });

  it("injects user agents but lets built-ins win on a name clash", () => {
    const config: { agent?: Record<string, unknown> } = {};
    const userAgents = {
      reviewer: { mode: "subagent", prompt: "user" },
      commander: { mode: "primary", prompt: "user-tries-to-shadow" },
    };
    const added = mergeInjectables(config, builtins, userAgents);
    assert.equal((config.agent!.reviewer as { prompt: string }).prompt, "user");
    // commander is a built-in applied first, so the user version is skipped.
    assert.equal((config.agent!.commander as { prompt: string }).prompt, "built-in");
    assert.deepEqual(added.agents.sort(), ["coder", "commander", "reviewer"]);
  });
});

describe("validateAgents", () => {
  it("returns {} for an absent block", () => {
    assert.deepEqual(validateAgents(undefined), {});
  });

  it("accepts a map of agent objects", () => {
    const agents = { reviewer: { mode: "subagent", prompt: "x" } };
    assert.deepEqual(validateAgents(agents), agents);
  });

  it("rejects a non-object block", () => {
    assert.throws(() => validateAgents([]), /"agents" must be an object/);
    assert.throws(() => validateAgents("nope"), /"agents" must be an object/);
  });

  it("rejects a non-object agent entry", () => {
    assert.throws(() => validateAgents({ bad: "string" }), /agent "bad" must be an object/);
  });
});

describe("loadUserAgents", () => {
  it("reads and validates the agents block from openflow.json", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "of-inject-"));
    try {
      await writeFile(
        resolve(dir, "openflow.json"),
        JSON.stringify({ agents: { reviewer: { mode: "subagent", prompt: "x" } }, workflows: {} })
      );
      const agents = await loadUserAgents(dir);
      assert.deepEqual(Object.keys(agents), ["reviewer"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns {} when openflow.json is absent", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "of-inject-"));
    try {
      assert.deepEqual(await loadUserAgents(dir), {});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("loadBuiltins", () => {
  it("loads the bundled built-in agents and commands from the package", async () => {
    const builtin = await loadBuiltins();
    // The generated bundle ships commander + the /workflow command.
    assert.ok(builtin.agent["commander"], "commander built-in should be bundled");
    assert.ok(builtin.command["workflow"], "/workflow command should be bundled");
  });
});
