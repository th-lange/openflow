#!/usr/bin/env node
import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

async function install(targetDir = process.cwd()) {
  const targetPath = resolve(targetDir, "opencode.json");
  const config = await readJson(targetPath);
  let changed = false;

  // ── MCP server ──────────────────────────────────────────────────────────────
  const mcp = config.mcp ?? {};
  if (!mcp.openflow) {
    const distMcp = resolve(PKG_ROOT, "dist", "mcp.js");
    const useBuilt = await fileExists(distMcp);
    const mcpCommand = useBuilt
      ? ["node", distMcp]
      : ["node", "--import", "tsx/esm", resolve(PKG_ROOT, "src", "mcp.ts")];
    mcp.openflow = { type: "local", command: mcpCommand };
    config.mcp = mcp;
    changed = true;
    console.log("  ✓ MCP server configured");
  } else {
    console.log("  · MCP server already configured — skipping");
  }

  // ── /workflow command ────────────────────────────────────────────────────────
  const command = config.command ?? {};
  if (!command.workflow) {
    command.workflow = {
      description: "Execute a named workflow, e.g. /workflow feature",
      agent: "commander",
      template: "Run workflow: {{input}}",
    };
    config.command = command;
    changed = true;
    console.log("  ✓ /workflow command registered");
  } else {
    console.log("  · /workflow command already configured — skipping");
  }

  // ── agents ───────────────────────────────────────────────────────────────────
  const srcAgents = (await readJson(resolve(PKG_ROOT, "opencode.json"))).agent ?? {};
  const agents = config.agent ?? {};
  const added = [];
  const skipped = [];
  for (const [name, def] of Object.entries(srcAgents)) {
    if (agents[name]) {
      skipped.push(name);
    } else {
      agents[name] = def;
      added.push(name);
    }
  }
  if (added.length > 0) {
    config.agent = agents;
    changed = true;
    console.log(`  ✓ Agents added: ${added.join(", ")}`);
  }
  if (skipped.length > 0) {
    console.log(`  · Agents already present: ${skipped.join(", ")}`);
  }

  if (changed) {
    await writeJson(targetPath, config);
    console.log(`\n  Wrote ${targetPath}`);
  } else {
    console.log("\n  opencode.json is already fully configured — nothing to change.");
  }
  console.log("  Restart OpenCode to activate the /workflow command.\n");
}

const [,, cmd, ...args] = process.argv;

if (!cmd || cmd === "help" || cmd === "--help") {
  console.log("Usage: openflow install [directory]");
  console.log("  Configures openflow in opencode.json of the target directory (default: cwd)");
} else if (cmd === "install") {
  console.log("\nConfiguring openflow...\n");
  try {
    await install(args[0]);
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${cmd}`);
  console.log("Usage: openflow install [directory]");
  process.exit(1);
}
