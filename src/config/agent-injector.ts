import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";
import { resolveUserAgents } from "./workflow-loader.js";

// Single-file install (#79).
//
// Instead of `openflow install` copying agent and command definitions into the
// host's opencode.json, the plugin injects them at load time via the `config`
// hook. Two sources are merged:
//   1. Built-ins — bundled with the package (generated from src/agents/*.md into
//      the package's own opencode.json by `npm run build:agents`), plus the
//      /workflow and /build-workflow commands.
//   2. User agents — an optional top-level `agents` block in the project's
//      openflow.json, co-located with the workflows that reference them.
//
// The merge never clobbers a name already present in the host config, so a
// pre-existing opencode.json agent (or an earlier install that copied agents in)
// always wins. This makes `openflow.json` the single openflow-owned config and
// reduces the install footprint to the one unavoidable plugin entry.

/** An OpenCode AgentConfig entry (kept loose — the host owns the precise shape). */
export type AgentDef = Record<string, unknown>;
/** An OpenCode command entry. */
export type CommandDef = Record<string, unknown>;

export type Injectables = {
  agent: Record<string, AgentDef>;
  command: Record<string, CommandDef>;
};

// The package root is two levels up from this module (src/config or dist/config),
// where the generated opencode.json bundle ships.
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Built-in agents + commands bundled with the package. These are generated from
 * `src/agents/*.md` into the package's `opencode.json` (the same generator and
 * drift guard as before); here we read that file purely as a bundle. A missing
 * or unreadable bundle yields empties rather than throwing — injection is
 * best-effort and must never brick the host.
 */
export async function loadBuiltins(): Promise<Injectables> {
  const path = resolve(PKG_ROOT, "opencode.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return { agent: {}, command: {} };
  }
  const parsed = parse(raw, [], { allowTrailingComma: true });
  if (!parsed || typeof parsed !== "object") return { agent: {}, command: {} };
  const obj = parsed as Record<string, unknown>;
  return {
    agent: isRecord(obj["agent"]) ? (obj["agent"] as Record<string, AgentDef>) : {},
    command: isRecord(obj["command"]) ? (obj["command"] as Record<string, CommandDef>) : {},
  };
}

/**
 * User-defined agents from the global + project `openflow.json` `agents` blocks
 * (#82), global winning on a name collision. Validated via the shared loader; an
 * absent file or block yields {}.
 */
export async function loadUserAgents(directory: string): Promise<Record<string, AgentDef>> {
  return resolveUserAgents(directory);
}

/**
 * Merge built-in and user-defined agents/commands into the host `config`,
 * adding only names not already present (the host config always wins). Built-ins
 * are applied before user agents, so a reserved built-in (e.g. `commander`,
 * `workflow-builder`) is never shadowed by a same-named user agent. Mutates
 * `config` in place and returns the names that were actually added.
 */
export function mergeInjectables(
  config: { agent?: Record<string, unknown>; command?: Record<string, unknown> },
  builtins: Injectables,
  userAgents: Record<string, AgentDef>
): { agents: string[]; commands: string[] } {
  const agents = (config.agent ??= {});
  const commands = (config.command ??= {});
  const addedAgents: string[] = [];
  const addedCommands: string[] = [];

  for (const [name, def] of Object.entries(builtins.agent)) {
    if (!(name in agents)) {
      agents[name] = def;
      addedAgents.push(name);
    }
  }
  for (const [name, def] of Object.entries(userAgents)) {
    if (!(name in agents)) {
      agents[name] = def;
      addedAgents.push(name);
    }
  }
  for (const [name, def] of Object.entries(builtins.command)) {
    if (!(name in commands)) {
      commands[name] = def;
      addedCommands.push(name);
    }
  }

  return { agents: addedAgents, commands: addedCommands };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
