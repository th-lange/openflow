import { writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { type OpencodeClient } from "@opencode-ai/sdk";
import { assertAgentExists } from "../config/agent-registry.js";
import { loadWorkflows } from "../config/workflow-loader.js";
import {
  readConfigObject,
  readConfigText,
  resolveConfigPath,
  setConfigValue,
} from "../config/opencode-config.js";

// ── create_workflow ───────────────────────────────────────────────────────────

export type CreateWorkflowInput = {
  name: string;
  sequence: string[];
  description?: string;
  commanderMayAlsoUse?: string[];
  force?: boolean;
};

export async function createWorkflow(
  input: CreateWorkflowInput,
  client: OpencodeClient,
  directory: string = process.cwd()
): Promise<string> {
  const { name, sequence, description, force = false } = input;
  const commanderMayAlsoUse = input.commanderMayAlsoUse ?? sequence;

  if (!name.trim()) throw new Error("Workflow name must not be empty");
  if (sequence.length === 0) throw new Error("sequence must have at least one agent");

  // Validate all referenced agents exist
  const allAgents = [...new Set([...sequence, ...commanderMayAlsoUse])];
  for (const agent of allAgents) {
    await assertAgentExists(client, agent);
  }

  const path = resolve(directory, "openflow.json");
  const priorText = await readConfigText(path); // "" when the file does not yet exist
  const config = await readConfigObject(path);
  const workflows = (config["workflows"] ?? {}) as Record<string, unknown>;
  const existed = Boolean(workflows[name]);

  if (existed && !force) {
    throw new Error(`Workflow "${name}" already exists. Pass force=true to overwrite.`);
  }

  // Only enforce post-write validity if the file was already valid — otherwise a
  // pre-existing unrelated problem would block every create_workflow call.
  let wasValidBefore = true;
  try {
    await loadWorkflows(client, directory);
  } catch {
    wasValidBefore = false;
  }

  const entry = {
    ...(description ? { description } : {}),
    sequence,
    commanderMayAlsoUse,
  };

  await setConfigValue(path, ["workflows", name], entry);

  if (wasValidBefore) {
    try {
      await loadWorkflows(client, directory); // re-validate refs + cycles (#34)
    } catch (e) {
      // Roll back the write so we never persist a workflow that breaks the registry.
      if (priorText) await writeFile(path, priorText, "utf-8");
      else await rm(path, { force: true });
      throw e;
    }
  }

  return [
    `Workflow "${name}" ${existed ? "updated" : "created"} in openflow.json.`,
    ``,
    `  sequence:            ${sequence.join(" → ")}`,
    `  commanderMayAlsoUse: [${commanderMayAlsoUse.join(", ")}]`,
    ...(description ? [`  description:         ${description}`] : []),
    ``,
    `Run it with: /workflow ${name}`,
  ].join("\n");
}

// ── enable_workflow / disable_workflow ────────────────────────────────────────

async function setWorkflowDisabled(
  name: string,
  disabled: boolean,
  directory: string
): Promise<string> {
  if (!name.trim()) throw new Error("Workflow name must not be empty");

  const path = resolve(directory, "openflow.json");
  const config = await readConfigObject(path);
  const workflows = (config["workflows"] ?? {}) as Record<string, unknown>;

  if (!workflows[name]) {
    throw new Error(`Workflow "${name}" not found in openflow.json`);
  }

  // `undefined` deletes the key (re-enabling); `true` disables.
  await setConfigValue(path, ["workflows", name, "disabled"], disabled ? true : undefined);

  const state = disabled ? "disabled" : "enabled";
  return `Workflow "${name}" is now ${state}.`;
}

export async function enableWorkflow(name: string, directory: string = process.cwd()): Promise<string> {
  return setWorkflowDisabled(name, false, directory);
}

export async function disableWorkflow(name: string, directory: string = process.cwd()): Promise<string> {
  return setWorkflowDisabled(name, true, directory);
}

// ── create_agent ──────────────────────────────────────────────────────────────

export type CreateAgentInput = {
  name: string;
  prompt: string;
  description?: string;
  mode?: "subagent" | "primary" | "all";
  model?: string;
  allowEdit?: boolean;
  allowBash?: boolean;
  force?: boolean;
};

export async function createAgent(
  input: CreateAgentInput,
  directory: string = process.cwd()
): Promise<string> {
  const {
    name,
    prompt,
    description,
    mode = "subagent",
    model,
    allowEdit = false,
    allowBash = false,
    force = false,
  } = input;

  if (!name.trim()) throw new Error("Agent name must not be empty");
  if (!prompt.trim()) throw new Error("Agent prompt must not be empty");

  // Resolve opencode.jsonc / opencode.json (prefer .jsonc) and write back to
  // the same file, preserving comments — see #35, #36.
  const { read, write } = await resolveConfigPath(directory);
  const config = await readConfigObject(read);
  const agents = (config["agent"] ?? {}) as Record<string, unknown>;
  const existed = Boolean(agents[name]);

  if (existed && !force) {
    throw new Error(`Agent "${name}" already exists. Pass force=true to overwrite.`);
  }

  const entry: Record<string, unknown> = {
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
