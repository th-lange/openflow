import { writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { assertAgentExists } from "../config/agent-registry.js";
import { loadWorkflows, parseWorkflowEntry, resolveWorkflowMaps, } from "../config/workflow-loader.js";
import { summariseWorkflow } from "./workflow-tools.js";
import { readConfigObject, readConfigText, resolveConfigPath, setConfigValue, } from "../config/opencode-config.js";
// Agent names reserved by openflow itself. They are shipped with the plugin and
// must not be created or overwritten through create_agent (#51).
const RESERVED_AGENTS = new Set(["workflow-builder"]);
/** True when the raw on-disk workflow entry is marked `locked: true`. */
function isLocked(entry) {
    return typeof entry === "object" && entry !== null && entry["locked"] === true;
}
/** Assemble the raw config object that gets persisted, per pattern. */
function buildEntry(input) {
    const pattern = input.pattern ?? "sequential";
    const base = input.description ? { description: input.description } : {};
    // sequential is the default and omits the pattern key for a clean config
    if (pattern !== "sequential")
        base["pattern"] = pattern;
    const pick = (...keys) => {
        for (const k of keys)
            if (input[k] !== undefined)
                base[k] = input[k];
    };
    switch (pattern) {
        case "sequential":
            base["sequence"] = input.sequence ?? [];
            base["commanderMayAlsoUse"] =
                input.commanderMayAlsoUse ??
                    (input.sequence ?? []).filter((s) => typeof s === "string");
            pick("contextScope", "compactContext");
            break;
        case "orchestrator":
            pick("agents", "satisfactionCriteria", "maxIterations");
            break;
        case "evaluator-optimizer":
            pick("producer", "evaluator", "passCriteria", "maxIterations");
            break;
        case "conditional":
            pick("router", "routes", "default");
            break;
        case "fanout":
            pick("agents", "picker", "pickerPrompt");
            break;
        case "parallel":
            pick("subtasks", "merger");
            break;
        case "debate":
            pick("proposer", "critic", "judge", "rounds");
            break;
    }
    return base;
}
/** Agent names directly referenced by a parsed workflow (excludes workflow refs). */
function referencedAgents(w) {
    switch (w.pattern) {
        case "sequential":
            return [
                ...w.sequence.filter((s) => typeof s === "string"),
                ...w.commanderMayAlsoUse,
            ];
        case "orchestrator":
            return w.agents;
        case "evaluator-optimizer":
            return [w.producer, w.evaluator];
        case "conditional":
            return [w.router];
        case "fanout":
            return [...w.agents, w.picker];
        case "parallel":
            return [...w.subtasks.map((s) => s.agent), w.merger];
        case "debate":
            return [w.proposer, w.critic, w.judge];
    }
}
export async function createWorkflow(input, client, directory = process.cwd()) {
    const { name, force = false } = input;
    if (!name.trim())
        throw new Error("Workflow name must not be empty");
    // 1. Build + shape-validate the entry off-disk. parseWorkflowEntry throws a
    //    precise error for any malformed/missing field, per pattern.
    const entry = buildEntry(input);
    const parsed = parseWorkflowEntry(name, entry);
    // 2. Always validate the agents this workflow directly references.
    for (const agent of new Set(referencedAgents(parsed))) {
        await assertAgentExists(client, agent);
    }
    const path = resolve(directory, "openflow.json");
    const priorText = await readConfigText(path); // "" when the file does not yet exist
    const config = await readConfigObject(path);
    const workflows = (config["workflows"] ?? {});
    const existed = Boolean(workflows[name]);
    // Locked workflows are immutable — refuse even with force (#51).
    if (existed && isLocked(workflows[name])) {
        throw new Error(`Workflow "${name}" is locked and cannot be modified.`);
    }
    if (existed && !force) {
        throw new Error(`Workflow "${name}" already exists. Pass force=true to overwrite.`);
    }
    // 3. Only enforce whole-registry validity (refs + cycles) if the file was
    //    already valid — otherwise a pre-existing unrelated problem would block
    //    every create_workflow call.
    let wasValidBefore = true;
    try {
        await loadWorkflows(client, directory);
    }
    catch {
        wasValidBefore = false;
    }
    await setConfigValue(path, ["workflows", name], entry);
    if (wasValidBefore) {
        try {
            await loadWorkflows(client, directory); // re-validate refs + cycles (#34, #40)
        }
        catch (e) {
            // Roll back so we never persist a workflow that breaks the registry.
            if (priorText)
                await writeFile(path, priorText, "utf-8");
            else
                await rm(path, { force: true });
            throw e;
        }
    }
    // Warn if a global workflow of the same name will shadow this project entry
    // at runtime (global wins — project is additive only, #82).
    const { origin } = await resolveWorkflowMaps(directory);
    const shadowed = origin[name] === "global";
    return [
        `Workflow "${name}" ${existed ? "updated" : "created"} in openflow.json.`,
        ``,
        `  pattern: ${parsed.pattern}`,
        `  ${summariseWorkflow({ ...parsed, name })}`,
        ...(input.description ? [`  description: ${input.description}`] : []),
        ``,
        ...(shadowed
            ? [
                `⚠ A global workflow named "${name}" already exists and takes precedence.`,
                `  This project entry will not run until the global one is renamed or removed`,
                `  (global workflows win over project workflows). Use a different name to add a`,
                `  project-specific workflow.`,
                ``,
            ]
            : []),
        `Run it with: /workflow ${name}`,
    ].join("\n");
}
// ── enable_workflow / disable_workflow ────────────────────────────────────────
async function setWorkflowDisabled(name, disabled, directory) {
    if (!name.trim())
        throw new Error("Workflow name must not be empty");
    const path = resolve(directory, "openflow.json");
    const config = await readConfigObject(path);
    const workflows = (config["workflows"] ?? {});
    if (!workflows[name]) {
        throw new Error(`Workflow "${name}" not found in openflow.json`);
    }
    if (isLocked(workflows[name])) {
        throw new Error(`Workflow "${name}" is locked and cannot be enabled or disabled.`);
    }
    // `undefined` deletes the key (re-enabling); `true` disables.
    await setConfigValue(path, ["workflows", name, "disabled"], disabled ? true : undefined);
    const state = disabled ? "disabled" : "enabled";
    return `Workflow "${name}" is now ${state}.`;
}
export async function enableWorkflow(name, directory = process.cwd()) {
    return setWorkflowDisabled(name, false, directory);
}
export async function disableWorkflow(name, directory = process.cwd()) {
    return setWorkflowDisabled(name, true, directory);
}
export async function createAgent(input, directory = process.cwd()) {
    const { name, prompt, description, mode = "subagent", model, allowEdit = false, allowBash = false, force = false, } = input;
    if (!name.trim())
        throw new Error("Agent name must not be empty");
    if (!prompt.trim())
        throw new Error("Agent prompt must not be empty");
    if (RESERVED_AGENTS.has(name)) {
        throw new Error(`Agent "${name}" is reserved by openflow and cannot be created or modified.`);
    }
    // Resolve opencode.jsonc / opencode.json (prefer .jsonc) and write back to
    // the same file, preserving comments — see #35, #36.
    const { read, write } = await resolveConfigPath(directory);
    const config = await readConfigObject(read);
    const agents = (config["agent"] ?? {});
    const existed = Boolean(agents[name]);
    if (existed && !force) {
        throw new Error(`Agent "${name}" already exists. Pass force=true to overwrite.`);
    }
    const entry = {
        ...(description ? { description } : {}),
        mode,
        prompt,
        permission: {
            edit: allowEdit ? "allow" : "deny",
            bash: allowBash ? "allow" : "deny",
        },
        tools: {},
        ...(model ? { model } : {}),
    };
    await setConfigValue(write, ["agent", name], entry);
    return [
        `Agent "${name}" ${existed ? "updated" : "created"} in ${write.split("/").pop()}.`,
        ``,
        `  mode:      ${mode}`,
        `  edit:      ${allowEdit ? "allow" : "deny"}`,
        `  bash:      ${allowBash ? "allow" : "deny"}`,
        ...(model ? [`  model:     ${model}`] : []),
        ``,
        `⚠ OpenCode must reload (restart or re-open the project) before this agent`,
        `  is available. After that, use it in a workflow or call delegate_task directly.`,
    ].join("\n");
}
//# sourceMappingURL=management-tools.js.map