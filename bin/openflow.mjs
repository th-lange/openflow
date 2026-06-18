#!/usr/bin/env node
import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, modify, applyEdits } from "jsonc-parser";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FORMATTING = { tabSize: 2, insertSpaces: true, eol: "\n" };

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

async function readText(path) {
  try {
    return await readFile(path, "utf-8");
  } catch (e) {
    if (e.code === "ENOENT") return "";
    throw new Error(`Could not read ${path}: ${e.message}`);
  }
}

// Parse JSON or JSONC (comments + trailing commas tolerated) into an object.
function parseConfig(text) {
  if (!text.trim()) return {};
  const errors = [];
  const parsed = parse(text, errors, { allowTrailingComma: true });
  return parsed && typeof parsed === "object" ? parsed : {};
}

async function install(targetDir) {
  const dir = targetDir ?? openCodeGlobalDir();
  const { read, write } = await resolveConfigPath(dir);

  console.log(`  Target: ${write}`);

  // Edit the original text in place so comments and formatting survive (#36).
  let text = (await readText(read)) || "{}\n";
  const config = parseConfig(text);
  const edits = []; // [{ path, value }]
  let changed = false;

  // ── plugin ────────────────────────────────────────────────────────────────
  // Register openflow as a native OpenCode plugin (ADR 0001 / #39). Point at the
  // built dist/plugin.js when present, else the TS source (OpenCode runs on Bun
  // and imports .ts directly). Use an absolute file:// URL so it resolves
  // regardless of the target project's location.
  const distPlugin = resolve(PKG_ROOT, "dist", "plugin.js");
  const pluginFile = (await fileExists(distPlugin)) ? distPlugin : resolve(PKG_ROOT, "src", "plugin.ts");
  const pluginEntry = pathToFileURL(pluginFile).href;
  const existingPlugins = Array.isArray(config.plugin) ? config.plugin : [];
  if (!existingPlugins.includes(pluginEntry)) {
    edits.push({ path: ["plugin"], value: [...existingPlugins, pluginEntry] });
    changed = true;
    console.log("  ✓ openflow plugin registered");
  } else {
    console.log("  · openflow plugin already registered — skipping");
  }

  // ── /workflow slash command ──────────────────────────────────────────────────
  // Uses the JSON "command" config key so OpenCode routes to commander automatically,
  // regardless of which agent the user currently has active.
  if (!config.command?.workflow) {
    edits.push({
      path: ["command", "workflow"],
      value: {
        description: "Run a named openflow workflow",
        agent: "commander",
        template: "Run workflow: $ARGUMENTS",
      },
    });
    changed = true;
    console.log("  ✓ /workflow command registered");
  } else {
    console.log("  · /workflow command already configured — skipping");
  }

  // ── /build-workflow slash command ────────────────────────────────────────────
  // Routes to the workflow-builder primary agent for interactive authoring.
  if (!config.command?.["build-workflow"]) {
    edits.push({
      path: ["command", "build-workflow"],
      value: {
        description: "Interactively create or modify a workflow",
        agent: "workflow-builder",
        template: "$ARGUMENTS",
      },
    });
    changed = true;
    console.log("  ✓ /build-workflow command registered");
  } else {
    console.log("  · /build-workflow command already configured — skipping");
  }

  // ── agents ───────────────────────────────────────────────────────────────────
  const srcAgents = parseConfig(await readText(resolve(PKG_ROOT, "opencode.json"))).agent ?? {};
  const existingAgents = config.agent ?? {};
  const added = [];
  const skipped = [];
  for (const [name, def] of Object.entries(srcAgents)) {
    if (existingAgents[name]) {
      skipped.push(name);
    } else {
      edits.push({ path: ["agent", name], value: def });
      added.push(name);
    }
  }
  if (added.length > 0) {
    changed = true;
    console.log(`  ✓ Agents added: ${added.join(", ")}`);
  }
  if (skipped.length > 0) {
    console.log(`  · Agents already present: ${skipped.join(", ")}`);
  }

  if (changed) {
    for (const { path, value } of edits) {
      text = applyEdits(text, modify(text, path, value, { formattingOptions: FORMATTING }));
    }
    await mkdir(dirname(write), { recursive: true });
    await writeFile(write, text.endsWith("\n") ? text : text + "\n", "utf-8");
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
