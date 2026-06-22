import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";
import { readOpenflowFile, validateAgents } from "./workflow-loader.js";
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
export async function loadBuiltins() {
    const path = resolve(PKG_ROOT, "opencode.json");
    let raw;
    try {
        raw = await readFile(path, "utf-8");
    }
    catch {
        return { agent: {}, command: {} };
    }
    const parsed = parse(raw, [], { allowTrailingComma: true });
    if (!parsed || typeof parsed !== "object")
        return { agent: {}, command: {} };
    const obj = parsed;
    return {
        agent: isRecord(obj["agent"]) ? obj["agent"] : {},
        command: isRecord(obj["command"]) ? obj["command"] : {},
    };
}
/**
 * User-defined agents from the project's `openflow.json` `agents` block.
 * Validated via the shared loader; an absent file or block yields {}.
 */
export async function loadUserAgents(directory) {
    const parsed = await readOpenflowFile(directory);
    if (!isRecord(parsed))
        return {};
    return validateAgents(parsed["agents"]);
}
/**
 * Merge built-in and user-defined agents/commands into the host `config`,
 * adding only names not already present (the host config always wins). Built-ins
 * are applied before user agents, so a reserved built-in (e.g. `commander`,
 * `workflow-builder`) is never shadowed by a same-named user agent. Mutates
 * `config` in place and returns the names that were actually added.
 */
export function mergeInjectables(config, builtins, userAgents) {
    const agents = (config.agent ??= {});
    const commands = (config.command ??= {});
    const addedAgents = [];
    const addedCommands = [];
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
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
//# sourceMappingURL=agent-injector.js.map