import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { extractHandoff, compactForThread, HANDOFF_FALLBACK_LIMIT } from "../utils/handoff.js";
import { runSequential } from "../tools/run-workflow.js";
import { clearAgentCache } from "../config/agent-registry.js";
import { DEFAULT_SETTINGS } from "../config/workflow-loader.js";
import type { SequentialWorkflow } from "../config/workflow-loader.js";
import { makeFakeClient } from "./fake-client.js";

const settings = DEFAULT_SETTINGS;
const noopDispatch = (() => Promise.resolve("")) as any;

describe("extractHandoff", () => {
  it("returns the inner text of a fenced handoff block", () => {
    const text = "Lots of narrative...\n\n```handoff\nFiles: a.ts\nNext: review\n```\n";
    assert.equal(extractHandoff(text), "Files: a.ts\nNext: review");
  });

  it("returns the last block when several are present", () => {
    const text = "```handoff\nfirst\n```\nmore\n```handoff\nsecond\n```";
    assert.equal(extractHandoff(text), "second");
  });

  it("returns null when no block is present", () => {
    assert.equal(extractHandoff("no block here"), null);
    assert.equal(extractHandoff("```handoff\n\n```"), null); // empty block
  });
});

describe("compactForThread", () => {
  it("uses the handoff block when present", () => {
    const text = "huge output\n".repeat(500) + "```handoff\nsummary\n```";
    assert.equal(compactForThread(text), "summary");
  });

  it("passes through short output unchanged when there is no block", () => {
    assert.equal(compactForThread("short"), "short");
  });

  it("truncates long output with a re-read note when there is no block", () => {
    const text = "x".repeat(HANDOFF_FALLBACK_LIMIT + 500);
    const out = compactForThread(text);
    assert.ok(out.length < text.length);
    assert.match(out, /truncated 500 chars — re-read the source files/);
  });
});

describe("handoff compaction in runSequential", () => {
  afterEach(clearAgentCache);

  const seq = (overrides: Partial<SequentialWorkflow> = {}): SequentialWorkflow => ({
    pattern: "sequential",
    sequence: ["a", "b", "c"],
    commanderMayAlsoUse: [],
    ...overrides,
  });

  // Each agent emits a long narrative plus a small handoff block.
  function clientFor() {
    return makeFakeClient({
      agents: ["a", "b", "c"],
      respond: (agent) => `NARRATIVE-${agent} `.repeat(200) + `\n\`\`\`handoff\nHANDOFF-${agent}\n\`\`\``,
    });
  }

  it("threads only the handoff block by default, not the narrative", async () => {
    const client = clientFor();
    await runSequential(seq(), "task", undefined, "sess", client, "/tmp", noopDispatch, settings);
    const bSawA = client.calls[1].text; // step b sees step a
    assert.match(bSawA, /HANDOFF-a/);
    assert.doesNotMatch(bSawA, /NARRATIVE-a/);
  });

  it("compacts intermediate steps in the relay but keeps the final step in full", async () => {
    const client = clientFor();
    const out = await runSequential(seq(), "task", undefined, "sess", client, "/tmp", noopDispatch, settings);
    // intermediate step a: handoff only, no narrative
    assert.match(out, /HANDOFF-a/);
    assert.doesNotMatch(out, /NARRATIVE-a/);
    // final step c: full narrative present
    assert.match(out, /NARRATIVE-c/);
  });

  it("compactContext:false threads and relays full output (pre-#64 behaviour)", async () => {
    const client = clientFor();
    const out = await runSequential(
      seq({ compactContext: false }),
      "task",
      undefined,
      "sess",
      client,
      "/tmp",
      noopDispatch,
      settings
    );
    assert.match(client.calls[1].text, /NARRATIVE-a/); // full narrative threaded
    assert.match(out, /NARRATIVE-a/); // full narrative relayed
  });
});
