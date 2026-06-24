import { type OpencodeClient } from "@opencode-ai/sdk";
export type SequenceStep = string | {
    checkpoint: string;
} | {
    workflow: string;
};
/**
 * How much prior-step output a sequential workflow threads into each subsequent
 * step (#63). Threading every prior step's full output is O(n²) in tokens; this
 * lets a workflow trade context completeness for cost.
 * - `all`  — every prior step's output (default; current behavior)
 * - `last` — only the immediately preceding step's output
 * - `none` — no prior-step context (each step sees only the prompt)
 */
export type ContextScope = "all" | "last" | "none";
export declare const CONTEXT_SCOPES: readonly ContextScope[];
export declare const DEFAULT_CONTEXT_SCOPE: ContextScope;
/**
 * Whether a sequential workflow threads compact structured handoffs between
 * steps (the default) instead of full step outputs (#64). When `true`, each
 * step's `\`\`\`handoff` block — or a truncated fallback — is threaded and shown
 * in the relay for intermediate steps; the final step is always shown in full.
 * Set `false` to restore full-output threading and relay (pre-#64 behaviour).
 */
export declare const DEFAULT_COMPACT_CONTEXT = true;
export type SequentialWorkflow = {
    pattern: "sequential";
    description?: string;
    disabled?: boolean;
    locked?: boolean;
    sequence: SequenceStep[];
    commanderMayAlsoUse: string[];
    contextScope?: ContextScope;
    compactContext?: boolean;
};
export type OrchestratorWorkflow = {
    pattern: "orchestrator";
    description?: string;
    disabled?: boolean;
    locked?: boolean;
    agents: string[];
    maxIterations: number;
    satisfactionCriteria: string;
};
export type EvaluatorOptimizerWorkflow = {
    pattern: "evaluator-optimizer";
    description?: string;
    disabled?: boolean;
    locked?: boolean;
    producer: string;
    evaluator: string;
    maxIterations: number;
    passCriteria: string;
};
export type ConditionalWorkflow = {
    pattern: "conditional";
    description?: string;
    disabled?: boolean;
    locked?: boolean;
    router: string;
    routes: Array<{
        condition: string;
        workflow: string;
    }>;
    default: string;
};
export type FanoutWorkflow = {
    pattern: "fanout";
    description?: string;
    disabled?: boolean;
    locked?: boolean;
    agents: string[];
    picker: string;
    pickerPrompt?: string;
};
export type ParallelWorkflow = {
    pattern: "parallel";
    description?: string;
    disabled?: boolean;
    locked?: boolean;
    subtasks: Array<{
        agent: string;
        prompt: string;
    }>;
    merger: string;
};
export type DebateWorkflow = {
    pattern: "debate";
    description?: string;
    disabled?: boolean;
    locked?: boolean;
    proposer: string;
    critic: string;
    rounds: number;
    judge: string;
    compactContext?: boolean;
};
export type Workflow = SequentialWorkflow | OrchestratorWorkflow | EvaluatorOptimizerWorkflow | ConditionalWorkflow | FanoutWorkflow | ParallelWorkflow | DebateWorkflow;
export type WorkflowRegistry = Record<string, Workflow>;
/** Optional Langfuse tracing config (#67). API keys come from the environment. */
export type LangfuseSettings = {
    /** Master switch; tracing is off unless this is true. */
    enabled: boolean;
    /** Self-hosted Langfuse base URL; falls back to LANGFUSE_HOST then Langfuse cloud. */
    host?: string;
};
export type EngineSettings = {
    /** Per-agent delegation timeout in milliseconds. */
    agentTimeoutMs: number;
    /** Maximum number of agents dispatched concurrently (fan-out/parallel). */
    maxConcurrent: number;
    /** Langfuse tracing; undefined or { enabled: false } means no tracing. */
    langfuse?: LangfuseSettings;
};
export declare const DEFAULT_SETTINGS: EngineSettings;
/**
 * Merge an optional `settings` block (as read from openflow.json) with
 * environment-variable overrides and the built-in defaults. Environment
 * variables take precedence over the file so operators can tune a running
 * install without editing config. Throws on malformed values so a bad setting
 * is caught at startup rather than silently ignored.
 */
export declare function mergeSettings(raw: unknown): EngineSettings;
/**
 * Validate the optional top-level `agents` block in openflow.json. It maps an
 * agent name to an OpenCode AgentConfig object, injected into the host at load
 * time (see agent-injector.ts). Validation is intentionally shallow — name →
 * object — because OpenCode owns the precise AgentConfig schema and validates it
 * itself. Returns the block (or {} when absent); throws on a malformed shape so
 * a typo is caught at startup rather than silently dropped.
 */
export declare function validateAgents(raw: unknown): Record<string, Record<string, unknown>>;
/**
 * Resolve engine settings from `openflow.json` in `directory`, merged with
 * environment overrides and defaults. Missing file or missing `settings` block
 * yields the defaults.
 */
export declare function resolveSettings(directory?: string): Promise<EngineSettings>;
/**
 * Read and parse `openflow.json` (JSON or JSONC) from `directory`.
 * Returns the parsed top-level value, or `undefined` when the file is absent.
 * Throws when the file exists but is not valid JSON/JSONC.
 *
 * This is the one read path shared by the validating loader and the runtime
 * lookup tools (see workflow-tools.ts) — #38.
 */
export declare function readOpenflowFile(directory?: string): Promise<unknown | undefined>;
/**
 * Which layer a workflow (or other entry) came from. Workflows defined in the
 * **global** `openflow.json` are a shared baseline available in every project; a
 * **project** `openflow.json` is additive and may introduce new workflows but
 * cannot shadow a global one (global wins on a name collision).
 */
export type WorkflowOrigin = "global" | "project";
/**
 * OpenCode's global config directory — the same location `openflow install`
 * targets. `OPENFLOW_GLOBAL_DIR` overrides it (used by tests to stay hermetic);
 * otherwise XDG_CONFIG_HOME / ~/.config/opencode, or %APPDATA%\opencode on
 * Windows.
 */
export declare function openflowGlobalDir(): string;
/**
 * Resolve the merged workflow map from the global + project layers (#82).
 * Project entries are laid down first, then global entries overlaid, so a name
 * present in both resolves to the **global** definition (project is additive and
 * cannot shadow a global workflow). Returns the merged raw map plus the origin
 * of each name for listings and diagnostics.
 */
export declare function resolveWorkflowMaps(projectDir?: string): Promise<{
    merged: Record<string, unknown>;
    origin: Record<string, WorkflowOrigin>;
}>;
/**
 * Resolve user-defined agents from the global + project layers (#82), global
 * winning on a name collision — consistent with workflow resolution and with
 * the built-in-wins precedence in agent injection (#79).
 */
export declare function resolveUserAgents(directory?: string): Promise<Record<string, Record<string, unknown>>>;
export declare function loadWorkflows(client: OpencodeClient, directory?: string): Promise<WorkflowRegistry>;
/**
 * Parse and validate a single workflow entry into a typed `Workflow`.
 * Throws on malformed input. This is the canonical per-entry parser shared by
 * the loader and the runtime lookup tools (#38).
 */
export declare function parseWorkflowEntry(name: string, raw: unknown): Workflow;
//# sourceMappingURL=workflow-loader.d.ts.map