/**
 * E2E test — runs all 10 scenarios from issue #20.
 *
 *   npm run e2e
 *
 * Starts its own OpenCode server, so no running instance is needed.
 * Makes real LLM calls for scenarios 2–6.
 */

import { createOpencodeClient, createOpencodeServer, type TextPart } from "@opencode-ai/sdk";
import { getWorkflow, listWorkflows } from "../tools/workflow-tools.js";
import { delegateTask } from "../tools/delegate-task.js";
import { loadWorkflows } from "../config/workflow-loader.js";
import { clearAgentCache } from "../config/agent-registry.js";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Helpers ───────────────────────────────────────────────────────────────────

const WORK_DIR = process.cwd();
const SCENARIO_TIMEOUT = 3 * 60 * 1000;

type Result = { name: string; pass: boolean; note: string };
const results: Result[] = [];

function pass(name: string, note = "") {
  results.push({ name, pass: true, note });
  console.log(`  ✔ ${name}${note ? ` — ${note}` : ""}`);
}

function fail(name: string, note: string) {
  results.push({ name, pass: false, note });
  console.log(`  ✘ ${name} — ${note}`);
}

async function timeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

function extractText(parts: any[]): string {
  return parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}

// ── Start server ──────────────────────────────────────────────────────────────

console.log("Starting OpenCode server...");
const server = await createOpencodeServer({ port: 4096 });
const SERVER_URL = server.url;
const client = createOpencodeClient({ baseUrl: SERVER_URL });
console.log(`Server at ${SERVER_URL}\n`);

// ── Scenario 1: list_workflows returns available workflows ────────────────────

console.log("Scenario 1: list_workflows");
try {
  const workflows = await listWorkflows(WORK_DIR);
  const names = workflows.map((w) => w.name);
  if (names.includes("feature") && names.includes("review") && names.includes("implement")) {
    pass("1. list_workflows returns defined workflows", names.join(", "));
  } else {
    fail("1. list_workflows", `Got: ${names.join(", ")}`);
  }
} catch (e) {
  fail("1. list_workflows", String(e));
}

// ── Scenario 2: get_workflow returns correct sequence ─────────────────────────

console.log("\nScenario 2: get_workflow");
try {
  const wf = await getWorkflow("feature", WORK_DIR);
  if (
    JSON.stringify(wf.sequence) === JSON.stringify(["composer", "coder", "analyzer"])
  ) {
    pass("2. get_workflow('feature') returns correct sequence");
  } else {
    fail("2. get_workflow", `Sequence: ${JSON.stringify(wf.sequence)}`);
  }
} catch (e) {
  fail("2. get_workflow", String(e));
}

// ── Scenario 3: /workflow feature → commander runs full 3-step workflow ────────

console.log("\nScenario 3: /workflow feature → full workflow (LLM call — may take ~2 min)");
try {
  const sessionResult = await client.session.create({ body: {} });
  if (sessionResult.error) throw new Error(JSON.stringify(sessionResult.error));
  const sessionId = sessionResult.data!.id;

  const promptResult = await timeout(SCENARIO_TIMEOUT, () =>
    client.session.prompt({
      path: { id: sessionId },
      body: {
        agent: "commander",
        parts: [
          {
            type: "text",
            text: "Run workflow: feature\n\nTask: The add() function in src/test/fixtures/calculator.ts subtracts instead of adds. Fix it.",
          },
        ],
      },
    })
  );

  if (promptResult.error) throw new Error(JSON.stringify(promptResult.error));

  const text = extractText(promptResult.data!.parts);
  await client.session.delete({ path: { id: sessionId } });

  // Commander should have mentioned all three agents
  const mentionsComposer = /composer/i.test(text);
  const mentionsCoder = /coder/i.test(text);
  const mentionsAnalyzer = /analyzer/i.test(text);

  if (mentionsComposer && mentionsCoder && mentionsAnalyzer) {
    pass("3. Full workflow ran all 3 steps", `response length: ${text.length} chars`);
    console.log("\n    --- Workflow output (first 800 chars) ---");
    console.log("   ", text.slice(0, 800).replace(/\n/g, "\n    "));
    console.log("    --- end ---\n");
  } else {
    fail(
      "3. Full workflow",
      `Missing agents in output. composer=${mentionsComposer} coder=${mentionsCoder} analyzer=${mentionsAnalyzer}\n    Output: ${text.slice(0, 400)}`
    );
  }
} catch (e) {
  fail("3. Full workflow", String(e));
}

// ── Scenario 4: context propagation (step N result appears in step N+1) ───────

console.log("\nScenario 4: context propagation");
try {
  // Use the implement workflow (coder → analyzer) with an explicit marker
  const sessionResult = await client.session.create({ body: {} });
  if (sessionResult.error) throw new Error(JSON.stringify(sessionResult.error));
  const sessionId = sessionResult.data!.id;

  const promptResult = await timeout(SCENARIO_TIMEOUT, () =>
    client.session.prompt({
      path: { id: sessionId },
      body: {
        agent: "commander",
        parts: [
          {
            type: "text",
            text: "Run workflow: implement\n\nTask: Add an export const VERSION = '1.0.0' to src/test/fixtures/calculator.ts",
          },
        ],
      },
    })
  );

  if (promptResult.error) throw new Error(JSON.stringify(promptResult.error));
  const text = extractText(promptResult.data!.parts);
  await client.session.delete({ path: { id: sessionId } });

  // Analyzer should reference coder's work (at minimum, both ran)
  const mentionsCoder = /coder/i.test(text);
  const mentionsAnalyzer = /analyzer/i.test(text);

  if (mentionsCoder && mentionsAnalyzer) {
    pass("4. Context propagation — both steps ran and completed");
  } else {
    fail("4. Context propagation", `coder=${mentionsCoder} analyzer=${mentionsAnalyzer}`);
  }
} catch (e) {
  fail("4. Context propagation", String(e));
}

// ── Scenario 5: commanderMayAlsoUse correctly constrains permitted agents ──────
// Behavioral enforcement is in the system prompt and validated interactively.
// This test verifies the data contract: the workflow definition exposes the
// correct permitted-agent list for the commander to enforce against.

console.log("\nScenario 5: commanderMayAlsoUse data contract");
try {
  const review = await getWorkflow("review", WORK_DIR);
  const feature = await getWorkflow("feature", WORK_DIR);

  // review workflow only permits analyzer
  const reviewOk = review.commanderMayAlsoUse.includes("analyzer") &&
    !review.commanderMayAlsoUse.includes("openflow-echo");

  // feature workflow permits all three agents but not openflow-echo
  const featureOk = ["composer", "coder", "analyzer"].every(
    (a) => feature.commanderMayAlsoUse.includes(a)
  ) && !feature.commanderMayAlsoUse.includes("openflow-echo");

  if (reviewOk && featureOk) {
    pass(
      "5. commanderMayAlsoUse excludes unauthorized agents in both workflows",
      `review=[${review.commanderMayAlsoUse}] feature=[${feature.commanderMayAlsoUse}]`
    );
  } else {
    fail(
      "5. commanderMayAlsoUse data contract",
      `review=${JSON.stringify(review.commanderMayAlsoUse)} feature=${JSON.stringify(feature.commanderMayAlsoUse)}`
    );
  }
} catch (e) {
  fail("5. commanderMayAlsoUse data contract", String(e));
}

// ── Scenario 6: unknown workflow name → clear error ───────────────────────────

console.log("\nScenario 6: unknown workflow name");
try {
  await getWorkflow("nonexistent-workflow-xyz", WORK_DIR);
  fail("6. Unknown workflow", "Should have thrown but did not");
} catch (e) {
  const msg = String(e);
  if (/not found/i.test(msg) && /available/i.test(msg)) {
    pass("6. Unknown workflow → clear error with available list", msg.slice(0, 100));
  } else {
    fail("6. Unknown workflow", `Error missing context: ${msg}`);
  }
}

// ── Scenario 7: delegate_task with unknown agent → clear error ─────────────────

console.log("\nScenario 7: delegate_task with unknown agent");
try {
  await delegateTask({ agent: "ghost-agent-xyz", prompt: "hi" }, client);
  fail("7. Unknown agent in delegate_task", "Should have thrown but did not");
} catch (e) {
  const msg = String(e);
  if (/ghost-agent-xyz/i.test(msg)) {
    pass("7. Unknown agent → clear error naming the agent", msg.slice(0, 100));
  } else {
    fail("7. Unknown agent", `Error doesn't name the agent: ${msg}`);
  }
}

// ── Scenario 8: invalid openflow.json → error at load time ───────────────────

console.log("\nScenario 8: invalid openflow.json");
const tmpDir = join(tmpdir(), `openflow-e2e-${Date.now()}`);
const tmpJsonPath = join(tmpDir, "openflow.json");
try {
  await rm(tmpDir, { recursive: true, force: true });
  const { mkdir } = await import("node:fs/promises");
  await mkdir(tmpDir, { recursive: true });
  await writeFile(tmpJsonPath, "{ this is not valid json }", "utf-8");
  clearAgentCache();
  await loadWorkflows(client, tmpDir);
  fail("8. Invalid openflow.json", "Should have thrown but did not");
} catch (e) {
  const msg = String(e);
  if (/not valid JSON/i.test(msg)) {
    pass("8. Invalid openflow.json → error at load time");
  } else {
    fail("8. Invalid openflow.json", `Unexpected error: ${msg}`);
  }
} finally {
  await rm(tmpDir, { recursive: true, force: true });
  clearAgentCache();
}

// ── Scenario 9: empty sequence → error ───────────────────────────────────────

console.log("\nScenario 9: workflow with empty sequence");
const tmpDir2 = join(tmpdir(), `openflow-e2e2-${Date.now()}`);
try {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(tmpDir2, { recursive: true });
  await writeFile(
    join(tmpDir2, "openflow.json"),
    JSON.stringify({ workflows: { empty: { sequence: [] } } }),
    "utf-8"
  );
  clearAgentCache();
  await loadWorkflows(client, tmpDir2);
  fail("9. Empty sequence", "Should have thrown but did not");
} catch (e) {
  const msg = String(e);
  if (/non-empty/i.test(msg)) {
    pass("9. Empty sequence → clear error");
  } else {
    fail("9. Empty sequence", `Unexpected error: ${msg}`);
  }
} finally {
  await rm(tmpDir2, { recursive: true, force: true });
  clearAgentCache();
}

// ── Scenario 10: list_workflows on missing file → empty, no crash ─────────────

console.log("\nScenario 10: missing openflow.json → empty registry, no crash");
try {
  const workflows = await listWorkflows("/tmp/definitely-does-not-exist-openflow");
  if (Array.isArray(workflows) && workflows.length === 0) {
    pass("10. Missing openflow.json → empty list, no crash");
  } else {
    fail("10. Missing openflow.json", `Got unexpected result: ${JSON.stringify(workflows)}`);
  }
} catch (e) {
  fail("10. Missing openflow.json", `Should not throw: ${e}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

server.close();
console.log("\n" + "─".repeat(60));
console.log("E2E RESULTS");
console.log("─".repeat(60));
const passed = results.filter((r) => r.pass).length;
for (const r of results) {
  console.log(`  ${r.pass ? "✔" : "✘"} ${r.name}`);
}
console.log(`\n${passed}/${results.length} passed`);
if (passed < results.length) process.exit(1);
