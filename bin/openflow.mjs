#!/usr/bin/env node
import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// OpenCode global config dir: respects XDG_CONFIG_HOME, falls back to ~/.config/opencode
// Windows: %APPDATA%\opencode
function openCodeGlobalDir() {
  if (process.platform === "win32") {
    return resolve(process.env.APPDATA ?? resolve(homedir(), "AppData", "Roaming"), "opencode");
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config");
  return resolve(xdg, "opencode");
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

// Resolve which config file to read/write in a directory.
// Prefers .jsonc over .json — OpenCode uses .jsonc as its primary format.
// Reads and writes the same file; never creates a sibling file of the other type.
async function resolveConfigPath(dir) {
  const jsoncPath = resolve(dir, "opencode.jsonc");
  const jsonPath  = resolve(dir, "opencode.json");
  if (await fileExists(jsoncPath)) return { read: jsoncPath, write: jsoncPath };
  if (await fileExists(jsonPath))  return { read: jsonPath,  write: jsonPath };
  return { read: jsonPath, write: jsonPath }; // neither exists — create .json
}

// Parse JSONC: strip // and /* */ comments (skipping string literals), remove trailing commas
function normalizeJsonc(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === '"') {
      // String literal — copy verbatim so // inside URLs is preserved
      out += src[i++];
      while (i < src.length) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; }
        else if (src[i] === '"') { out += src[i++]; break; }
        else { out += src[i++]; }
      }
    } else if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += src[i++];
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

async function readConfig(path) {
  try {
    const raw = await readFile(path, "utf-8");
    const text = path.endsWith(".jsonc") ? normalizeJsonc(raw) : raw;
    return JSON.parse(text);
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw new Error(`Could not read ${path}: ${e.message}`);
  }
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

async function install(targetDir) {
  const dir = targetDir ?? openCodeGlobalDir();
  const { read, write } = await resolveConfigPath(dir);

  console.log(`  Target: ${write}`);

  const config = await readConfig(read);
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

  // ── /workflow slash command ──────────────────────────────────────────────────
  // Uses the JSON "command" config key so OpenCode routes to commander automatically,
  // regardless of which agent the user currently has active.
  const command = config.command ?? {};
  if (!command.workflow) {
    command.workflow = {
      description: "Run a named openflow workflow",
      agent: "commander",
      template: "Run workflow: $ARGUMENTS",
    };
    config.command = command;
    changed = true;
    console.log("  ✓ /workflow command registered");
  } else {
    console.log("  · /workflow command already configured — skipping");
  }

  // ── agents ───────────────────────────────────────────────────────────────────
  const srcAgents = (await readConfig(resolve(PKG_ROOT, "opencode.json"))).agent ?? {};
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
    await writeJson(write, config);
    console.log(`\n  Wrote ${write}`);
  } else {
    console.log("\n  Already fully configured — nothing to change.");
  }
  console.log("  Restart OpenCode to activate the /workflow command.\n");
}

const [,, cmd, ...args] = process.argv;

if (!cmd || cmd === "help" || cmd === "--help") {
  const globalDir = openCodeGlobalDir();
  console.log("Usage: openflow install [directory]");
  console.log(`  Installs into OpenCode global config by default (${globalDir})`);
  console.log("  Pass a directory to install into a specific project instead.");
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
