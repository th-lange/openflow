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

  // Agents and the /workflow + /build-workflow commands are no longer copied
  // here. The plugin injects them at load time via its `config` hook (#79), so
  // the only thing install must write is the one bootstrap plugin entry above.
  // Names already present in the host config are never overwritten by injection,
  // so earlier installs that copied agents/commands in keep working unchanged.

  if (changed) {
    for (const { path, value } of edits) {
      text = applyEdits(text, modify(text, path, value, { formattingOptions: FORMATTING }));
    }
    await mkdir(dirname(write), { recursive: true });
    await writeFile(write, text.endsWith("\n") ? text : text + "\n", "utf-8");
    console.log(`\n  Wrote ${write}`);
  } else {
    console.log("\n  Already registered — nothing to change.");
  }
  console.log("  Agents and the /workflow + /build-workflow commands are provided");
  console.log("  by the plugin itself — restart OpenCode to load them.\n");
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
