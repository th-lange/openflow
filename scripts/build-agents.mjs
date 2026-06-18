#!/usr/bin/env node
// Single source of truth for agent prompts (#41).
//
// Each src/agents/<name>.md owns one agent: a metadata block (everything except
// the prompt) followed by the prompt body in plain markdown. This script writes
// those into opencode.json's `agent.<name>` entries using jsonc-parser, so the
// surrounding config (mcp, command, comments, formatting) is preserved.
//
// Run via `npm run build:agents`. CI fails if the result differs from what is
// committed (see .github/workflows/ci.yml), guaranteeing the .md files and
// opencode.json never drift.

import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { modify, applyEdits } from "jsonc-parser";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS_DIR = resolve(ROOT, "src/agents");
const CONFIG = resolve(ROOT, "opencode.json");
const FMT = { tabSize: 2, insertSpaces: true, eol: "\n" };
const META_RE = /<!--\s*openflow-agent\s*([\s\S]*?)-->/;

/** Parse one agent .md file into { meta, prompt }. */
export function parseAgentFile(text, file = "<agent>") {
  const m = META_RE.exec(text);
  if (!m) throw new Error(`${file}: missing <!-- openflow-agent ... --> metadata block`);
  let meta;
  try {
    meta = JSON.parse(m[1].trim());
  } catch (e) {
    throw new Error(`${file}: metadata block is not valid JSON: ${e.message}`);
  }
  const prompt = text.slice(m.index + m[0].length).replace(/^\s*\n/, "").trimEnd();
  if (!prompt) throw new Error(`${file}: prompt body is empty`);
  return { meta, prompt };
}

async function main() {
  const files = (await readdir(AGENTS_DIR)).filter((f) => f.endsWith(".md")).sort();
  let text = await readFile(CONFIG, "utf-8");
  for (const file of files) {
    const name = basename(file, ".md");
    const { meta, prompt } = parseAgentFile(await readFile(resolve(AGENTS_DIR, file), "utf-8"), file);
    const entry = { ...meta, prompt };
    text = applyEdits(text, modify(text, ["agent", name], entry, { formattingOptions: FMT }));
  }
  await writeFile(CONFIG, text.endsWith("\n") ? text : text + "\n", "utf-8");
  console.log(`build-agents: wrote ${files.length} agent(s) to opencode.json`);
}

// Only run when invoked directly (allows importing parseAgentFile in tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("build-agents failed:", e.message);
    process.exit(1);
  });
}
