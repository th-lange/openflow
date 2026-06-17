import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type OpencodeClient } from "@opencode-ai/sdk";
import { assertAgentExists } from "../config/agent-registry.js";

// ── Shared helpers ────────────────────────────────────────────────────────────

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch (e: any) {
    if (e.code === "ENOENT") return {};
    throw new Error(`Failed to read ${path}: ${e.message}`);
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

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
  const config = await readJson(path);
  const workflows = (config["workflows"] ?? {}) as Record<string, unknown>;

  if (workflows[name] && !force) {
    throw new Error(
      `Workflow "${name}" already exists. Pass force=true to overwrite.`
    );
  }

  const entry = {
    ...(description ? { description } : {}),
    sequence,
    commanderMayAlsoUse,
  };

  config["workflows"] = { ...workflows, [name]: entry };
  await writeJson(path, config);

  return [
    `Workflow "${name}" ${workflows[name] ? "updated" : "created"} in openflow.json.`,
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
  const config = await readJson(path);
  const workflows = (config["workflows"] ?? {}) as Record<string, unknown>;

  if (!workflows[name]) {
    throw new Error(`Workflow "${name}" not found in openflow.json`);
  }

  const entry = workflows[name] as Record<string, unknown>;
  if (disabled) {
    entry["disabled"] = true;
  } else {
    delete entry["disabled"];
  }

  config["workflows"] = { ...workflows, [name]: entry };
  await writeJson(path, config);

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

  const path = resolve(directory, "opencode.json");
  const config = await readJson(path);
  const agents = (config["agent"] ?? {}) as Record<string, unknown>;

  if (agents[name] && !force) {
    throw new Error(
      `Agent "${name}" already exists. Pass force=true to overwrite.`
    );
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

  config["agent"] = { ...agents, [name]: entry };
  await writeJson(path, config);

  return [
    `Agent "${name}" ${agents[name] ? "updated" : "created"} in opencode.json.`,
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
