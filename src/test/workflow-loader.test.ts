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

  it("loads a valid orchestrator workflow", async () => {
    await withFixture(
      JSON.stringify({
        workflows: {
          smart: {
            pattern: "orchestrator",
            agents: ["composer", "coder"],
            maxIterations: 4,
            satisfactionCriteria: "All done.",
          },
        },
      }),
      async (dir) => {
        const client = makeClient(["composer", "coder"]);
        const registry = await loadWorkflows(client, dir);
        const w = registry["smart"];
        assert.equal(w.pattern, "orchestrator");
        if (w.pattern !== "orchestrator") throw new Error("type guard");
        assert.deepEqual(w.agents, ["composer", "coder"]);
        assert.equal(w.maxIterations, 4);
        assert.equal(w.satisfactionCriteria, "All done.");
      }
    );
  });

  it("defaults orchestrator maxIterations to 6 when omitted", async () => {
    await withFixture(
      JSON.stringify({
        workflows: {
          w: {
            pattern: "orchestrator",
            agents: ["coder"],
            satisfactionCriteria: "Done.",
          },
        },
      }),
      async (dir) => {
        const client = makeClient(["coder"]);
        const registry = await loadWorkflows(client, dir);
        const w = registry["w"];
        if (w.pattern !== "orchestrator") throw new Error("type guard");
        assert.equal(w.maxIterations, 6);
      }
    );
  });

  it("throws on orchestrator with empty agents array", async () => {
    await withFixture(
      JSON.stringify({
        workflows: {
          w: { pattern: "orchestrator", agents: [], satisfactionCriteria: "Done." },
        },
      }),
      async (dir) => {
        const client = makeClient([]);
        await assert.rejects(
          () => loadWorkflows(client, dir),
          /non-empty "agents"/
        );
      }
    );
  });

  it("throws on orchestrator missing satisfactionCriteria", async () => {
    await withFixture(
      JSON.stringify({
        workflows: { w: { pattern: "orchestrator", agents: ["coder"] } },
      }),
      async (dir) => {
        const client = makeClient(["coder"]);
        await assert.rejects(
          () => loadWorkflows(client, dir),
          /satisfactionCriteria/
        );
      }
    );
  });

  it("throws when orchestrator agents references unknown agent", async () => {
    await withFixture(
      JSON.stringify({
        workflows: {
          w: {
            pattern: "orchestrator",
            agents: ["ghost"],
            satisfactionCriteria: "Done.",
          },
        },
      }),
      async (dir) => {
        const client = makeClient(["coder"]);
        await assert.rejects(
          () => loadWorkflows(client, dir),
          /Unknown agent "ghost"/
        );
      }
    );
  });

  // ── evaluator-optimizer ────────────────────────────────────────────────────

  it("loads a valid evaluator-optimizer workflow", async () => {
    await withFixture(
      JSON.stringify({
        workflows: {
          qual: {
            pattern: "evaluator-optimizer",
            producer: "coder",
            evaluator: "analyzer",
            maxIterations: 2,
            passCriteria: "PASS",
          },
        },
      }),
      async (dir) => {
        const client = makeClient(["coder", "analyzer"]);
        const registry = await loadWorkflows(client, dir);
        const w = registry["qual"];
        assert.equal(w.pattern, "evaluator-optimizer");
        if (w.pattern !== "evaluator-optimizer") throw new Error("type guard");
        assert.equal(w.producer, "coder");
        assert.equal(w.evaluator, "analyzer");
        assert.equal(w.maxIterations, 2);
        assert.equal(w.passCriteria, "PASS");
      }
    );
  });

  it("defaults evaluator-optimizer maxIterations to 3 and passCriteria to PASS", async () => {
    await withFixture(
      JSON.stringify({
        workflows: {
          w: { pattern: "evaluator-optimizer", producer: "coder", evaluator: "analyzer" },
        },
      }),
      async (dir) => {
        const client = makeClient(["coder", "analyzer"]);
        const registry = await loadWorkflows(client, dir);
        const w = registry["w"];
        if (w.pattern !== "evaluator-optimizer") throw new Error("type guard");
        assert.equal(w.maxIterations, 3);
        assert.equal(w.passCriteria, "PASS");
      }
    );
  });

  it("throws on evaluator-optimizer missing producer", async () => {
    await withFixture(
      JSON.stringify({ workflows: { w: { pattern: "evaluator-optimizer", evaluator: "analyzer" } } }),
      async (dir) => {
        const client = makeClient(["analyzer"]);
        await assert.rejects(() => loadWorkflows(client, dir), /producer/);
      }
    );
  });

  it("throws on evaluator-optimizer missing evaluator", async () => {
    await withFixture(
      JSON.stringify({ workflows: { w: { pattern: "evaluator-optimizer", producer: "coder" } } }),
      async (dir) => {
        const client = makeClient(["coder"]);
        await assert.rejects(() => loadWorkflows(client, dir), /evaluator/);
      }
    );
  });

  it("throws when evaluator-optimizer references unknown agent", async () => {
    await withFixture(
      JSON.stringify({
        workflows: { w: { pattern: "evaluator-optimizer", producer: "ghost", evaluator: "analyzer" } },
      }),
      async (dir) => {
        const client = makeClient(["analyzer"]);
        await assert.rejects(() => loadWorkflows(client, dir), /Unknown agent "ghost"/);
      }
    );
  });

  // ── conditional ────────────────────────────────────────────────────────────

  it("loads a valid conditional workflow", async () => {
    await withFixture(
      JSON.stringify({
        workflows: {
          base: { sequence: ["coder"], commanderMayAlsoUse: [] },
          route: {
            pattern: "conditional",
            router: "composer",
            routes: [{ condition: "bug", workflow: "base" }],
            default: "base",
          },
        },
      }),
      async (dir) => {
        const client = makeClient(["coder", "composer"]);
        const registry = await loadWorkflows(client, dir);
        const w = registry["route"];
        assert.equal(w.pattern, "conditional");
        if (w.pattern !== "conditional") throw new Error("type guard");
        assert.equal(w.router, "composer");
        assert.deepEqual(w.routes, [{ condition: "bug", workflow: "base" }]);
        assert.equal(w.default, "base");
      }
    );
  });

  it("throws on conditional missing router", async () => {
    await withFixture(
      JSON.stringify({
        workflows: {
          base: { sequence: ["coder"] },
          w: { pattern: "conditional", routes: [{ condition: "x", workflow: "base" }], default: "base" },
        },
      }),
      async (dir) => {
        const client = makeClient(["coder"]);
        await assert.rejects(() => loadWorkflows(client, dir), /router/);
      }
    );
  });

  it("throws on conditional with empty routes array", async () => {
    await withFixture(
      JSON.stringify({
        workflows: {
          base: { sequence: ["coder"] },
          w: { pattern: "conditional", router: "composer", routes: [], default: "base" },
        },
      }),
      async (dir) => {
        const client = makeClient(["coder", "composer"]);
        await assert.rejects(() => loadWorkflows(client, dir), /non-empty "routes"/);
      }
    );
  });

  it("throws when conditional route references unknown workflow", async () => {
    await withFixture(
      JSON.stringify({
        workflows: {
          w: {
            pattern: "conditional",
            router: "composer",
            routes: [{ condition: "x", workflow: "ghost" }],
            default: "ghost",
          },
        },
      }),
      async (dir) => {
        const client = makeClient(["composer"]);
        await assert.rejects(() => loadWorkflows(client, dir), /unknown workflow "ghost"/);
      }
    );
  });

  it("throws when conditional default references unknown workflow", async () => {
    await withFixture(
      JSON.stringify({
        workflows: {
          base: { sequence: ["coder"] },
          w: {
            pattern: "conditional",
            router: "composer",
            routes: [{ condition: "x", workflow: "base" }],
            default: "ghost",
          },
        },
      }),
      async (dir) => {
        const client = makeClient(["coder", "composer"]);
        await assert.rejects(() => loadWorkflows(client, dir), /unknown workflow "ghost"/);
      }
    );
  });

  it("throws on unknown pattern", async () => {
    await withFixture(
      JSON.stringify({
        workflows: { w: { pattern: "magic", sequence: ["coder"] } },
      }),
      async (dir) => {
        const client = makeClient(["coder"]);
        await assert.rejects(
          () => loadWorkflows(client, dir),
          /unknown pattern/
        );
      }
    );
  });
});
