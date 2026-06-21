import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { OpencodeClient } from "@opencode-ai/sdk";
import {
  getAgentRegistry,
  formatModel,
  agentModelLabel,
  clearAgentCache,
} from "../config/agent-registry.js";
import { runSequential } from "../tools/run-workflow.js";
import { titleSession } from "../tools/session-title.js";
import { DEFAULT_SETTINGS } from "../config/workflow-loader.js";
import type { SequentialWorkflow } from "../config/workflow-loader.js";
import { makeFakeClient } from "./fake-client.js";

const settings = DEFAULT_SETTINGS;
const noopDispatch = (() => Promise.resolve("")) as any;

describe("agent model in the registry", () => {
  afterEach(clearAgentCache);

  it("maps the model from app.agents() onto the entry", async () => {
    const client = makeFakeClient({
      agents: ["coder", "composer"],
      agentModels: { coder: { providerID: "anthropic", modelID: "claude-opus-4-8" } },
    });
    const reg = await getAgentRegistry(client);
    assert.deepEqual(reg.find((a) => a.name === "coder")?.model, {
      providerID: "anthropic",
      modelID: "claude-opus-4-8",
    });
    assert.equal(reg.find((a) => a.name === "composer")?.model, undefined);
  });

  it("formatModel renders provider/model or undefined", () => {
    assert.equal(formatModel({ providerID: "anthropic", modelID: "claude-haiku-4-5" }), "anthropic/claude-haiku-4-5");
    assert.equal(formatModel(undefined), undefined);
  });

  it("agentModelLabel resolves the label for a named agent", async () => {
    const client = makeFakeClient({
      agents: ["coder"],
      agentModels: { coder: { providerID: "anthropic", modelID: "claude-opus-4-8" } },
    });
    assert.equal(await agentModelLabel(client, "coder"), "anthropic/claude-opus-4-8");
    assert.equal(await agentModelLabel(client, "unknown"), undefined);
  });
});

describe("model annotation in runSequential relay", () => {
  afterEach(clearAgentCache);

  it("shows the model for steps that set one, and omits it otherwise", async () => {
    const client = makeFakeClient({
      agents: ["a", "b"],
      agentModels: { a: { providerID: "anthropic", modelID: "claude-opus-4-8" } },
    });
    const wf: SequentialWorkflow = { pattern: "sequential", sequence: ["a", "b"], commanderMayAlsoUse: [] };
    const out = await runSequential(wf, "task", undefined, "sess", client, "/tmp", noopDispatch, settings);
    assert.match(out, /## Step 1\/2 — a \(anthropic\/claude-opus-4-8\)/);
    assert.match(out, /## Step 2\/2 — b\n/); // no model tag for b
    assert.doesNotMatch(out, /Step 2\/2 — b \(/);
  });
});

describe("titleSession", () => {
  it("titles the session after the workflow", async () => {
    const client = makeFakeClient({ agents: [] });
    await titleSession(client, "sess-1", "feature");
    assert.deepEqual(client.titled, [{ id: "sess-1", title: "workflow: feature" }]);
  });

  it("does nothing without a session id", async () => {
    const client = makeFakeClient({ agents: [] });
    await titleSession(client, undefined, "feature");
    assert.equal(client.titled.length, 0);
  });

  it("swallows update errors (best-effort)", async () => {
    const throwing = {
      session: { update: () => Promise.reject(new Error("boom")) },
    } as unknown as OpencodeClient;
    await titleSession(throwing, "sess", "feature"); // must not throw
  });
});
