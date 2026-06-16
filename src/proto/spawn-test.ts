/**
 * Prototype: validates that session.prompt() can spawn a child session
 * targeting a custom-named agent and receive a complete response.
 *
 * Run against a live OpenCode server:
 *   npm run proto
 *
 * What we're checking:
 *   1. Can we connect to the running OpenCode server?
 *   2. Can we create a child session?
 *   3. Does session.prompt() with a custom agent name work?
 *   4. Do we get a clean response (no parse errors, no hang)?
 */

import { createOpencodeClient, createOpencodeServer, type TextPart } from "@opencode-ai/sdk";

const PARENT_SESSION_ID = process.env.OPENCODE_SESSION_ID;
// This agent must exist in opencode.json under "agent"
const TEST_AGENT = "openflow-echo";

async function main() {
  // If OpenCode is already running (e.g. we're inside an active session), use it.
  // Otherwise spin up a temporary server against this directory.
  let serverUrl = process.env.OPENCODE_URL ?? "http://127.0.0.1:4096";
  let stopServer: (() => void) | undefined;

  const isRunning = await fetch(serverUrl + "/session")
    .then(() => true)
    .catch(() => false);

  if (!isRunning) {
    console.log("No server at", serverUrl, "— starting one...");
    const server = await createOpencodeServer({ port: 4096 });
    serverUrl = server.url;
    stopServer = server.close;
    console.log(`Server started at ${serverUrl}`);
  }

  console.log(`Connecting to OpenCode at ${serverUrl}`);
  const client = createOpencodeClient({ baseUrl: serverUrl });

  // 1. Confirm connection + list available agents
  const agentsResult = await client.app.agents();
  if (agentsResult.error) {
    console.error("Failed to connect:", agentsResult.error);
    process.exit(1);
  }
  const agents = agentsResult.data ?? [];
  console.log(
    `Connected. Agents available: ${agents.map((a) => a.name).join(", ") || "(none)"}`
  );

  const testAgent = agents.find((a) => a.name === TEST_AGENT);
  if (!testAgent) {
    console.error(
      `Agent "${TEST_AGENT}" not found. Add it to opencode.json under "agent".`
    );
    console.error(`Available: ${agents.map((a) => a.name).join(", ")}`);
    process.exit(1);
  }
  console.log(`Found agent "${TEST_AGENT}" (mode: ${testAgent.mode})`);

  // 2. Create a child session
  console.log("\nCreating child session...");
  const createResult = await client.session.create({
    body: PARENT_SESSION_ID ? { parentID: PARENT_SESSION_ID } : {},
  });
  if (createResult.error) {
    console.error("Failed to create session:", createResult.error);
    process.exit(1);
  }
  const sessionId = createResult.data!.id;
  console.log(`Child session created: ${sessionId}`);

  // 3. Send a prompt targeting our custom agent
  console.log(`\nSending prompt to agent "${TEST_AGENT}"...`);
  const start = Date.now();
  const promptResult = await client.session.prompt({
    path: { id: sessionId },
    body: {
      agent: TEST_AGENT,
      parts: [
        {
          type: "text",
          text: 'Reply with exactly: "openflow spawn OK"',
        },
      ],
    },
  });
  const elapsed = Date.now() - start;

  if (promptResult.error) {
    console.error("Prompt failed:", promptResult.error);
    // Clean up
    await client.session.delete({ path: { id: sessionId } });
    process.exit(1);
  }

  // 4. Inspect the response
  const { info, parts } = promptResult.data!;
  const textParts = parts.filter((p): p is TextPart => p.type === "text");
  const responseText = textParts.map((p) => p.text).join("");

  console.log(`\n--- Response (${elapsed}ms) ---`);
  console.log(responseText || "(no text parts)");
  console.log(`--- End ---`);
  console.log(`Message ID: ${info.id}`);
  console.log(`Parts: ${parts.length} (${parts.map((p) => p.type).join(", ")})`);

  // 5. Clean up
  await client.session.delete({ path: { id: sessionId } });
  console.log(`\nChild session ${sessionId} deleted.`);
  stopServer?.();
  console.log("\nPROTOTYPE RESULT: PASS");
}

main().catch((err) => {
  console.error("\nPROTOTYPE RESULT: FAIL");
  console.error(err);
  process.exit(1);
});
