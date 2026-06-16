import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

async function withFixture(
  content: string,
  fn: (dir: string) => Promise<void>
): Promise<void> {
  const dir = join(tmpdir(), `openflow-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "openflow.json"), content, "utf-8");
  try {
    clearAgentCache();
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
    clearAgentCache();
  }
}

describe("workflow-loader", () => {
  it("returns empty registry when no openflow.json exists", async () => {
    clearAgentCache();
    const dir = join(tmpdir(), "nonexistent-openflow-dir");
    const client = makeClient([]);
    const registry = await loadWorkflows(client, dir);
    assert.deepEqual(registry, {});
  });

  it("loads a valid workflow", async () => {
    await withFixture(
      JSON.stringify({
        workflows: {
          feature: {
            description: "Full cycle",
            sequence: ["composer", "coder"],
            commanderMayAlsoUse: ["composer", "coder"],
          },
        },
      }),
      async (dir) => {
        const client = makeClient(["composer", "coder"]);
        const registry = await loadWorkflows(client, dir);
        assert.equal(Object.keys(registry).length, 1);
        assert.deepEqual(registry["feature"].sequence, ["composer", "coder"]);
        assert.equal(registry["feature"].description, "Full cycle");
      }
    );
  });

  it("throws on invalid JSON", async () => {
    await withFixture("not json {{{", async (dir) => {
      const client = makeClient([]);
      await assert.rejects(
        () => loadWorkflows(client, dir),
        /not valid JSON/
      );
    });
  });

  it("throws on empty sequence", async () => {
    await withFixture(
      JSON.stringify({ workflows: { bad: { sequence: [] } } }),
      async (dir) => {
        const client = makeClient([]);
        await assert.rejects(
          () => loadWorkflows(client, dir),
          /non-empty/
        );
      }
    );
  });

  it("throws when sequence references unknown agent", async () => {
    await withFixture(
      JSON.stringify({
        workflows: { w: { sequence: ["ghost"] } },
      }),
      async (dir) => {
        const client = makeClient(["composer"]);
        await assert.rejects(
          () => loadWorkflows(client, dir),
          /Unknown agent "ghost"/
        );
      }
    );
  });

  it("throws when commanderMayAlsoUse references unknown agent", async () => {
    await withFixture(
      JSON.stringify({
        workflows: {
          w: { sequence: ["composer"], commanderMayAlsoUse: ["ghost"] },
        },
      }),
      async (dir) => {
        const client = makeClient(["composer"]);
        await assert.rejects(
          () => loadWorkflows(client, dir),
          /Unknown agent "ghost"/
        );
      }
    );
  });

  it("defaults commanderMayAlsoUse to empty array when omitted", async () => {
    await withFixture(
      JSON.stringify({ workflows: { w: { sequence: ["composer"] } } }),
      async (dir) => {
        const client = makeClient(["composer"]);
        const registry = await loadWorkflows(client, dir);
        assert.deepEqual(registry["w"].commanderMayAlsoUse, []);
      }
    );
  });
});
