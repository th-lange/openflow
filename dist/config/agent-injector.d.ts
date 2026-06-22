/** An OpenCode AgentConfig entry (kept loose — the host owns the precise shape). */
export type AgentDef = Record<string, unknown>;
/** An OpenCode command entry. */
export type CommandDef = Record<string, unknown>;
export type Injectables = {
    agent: Record<string, AgentDef>;
    command: Record<string, CommandDef>;
};
/**
 * Built-in agents + commands bundled with the package. These are generated from
 * `src/agents/*.md` into the package's `opencode.json` (the same generator and
 * drift guard as before); here we read that file purely as a bundle. A missing
 * or unreadable bundle yields empties rather than throwing — injection is
 * best-effort and must never brick the host.
 */
export declare function loadBuiltins(): Promise<Injectables>;
/**
 * User-defined agents from the global + project `openflow.json` `agents` blocks
 * (#82), global winning on a name collision. Validated via the shared loader; an
 * absent file or block yields {}.
 */
export declare function loadUserAgents(directory: string): Promise<Record<string, AgentDef>>;
/**
 * Merge built-in and user-defined agents/commands into the host `config`,
 * adding only names not already present (the host config always wins). Built-ins
 * are applied before user agents, so a reserved built-in (e.g. `commander`,
 * `workflow-builder`) is never shadowed by a same-named user agent. Mutates
 * `config` in place and returns the names that were actually added.
 */
export declare function mergeInjectables(config: {
    agent?: Record<string, unknown>;
    command?: Record<string, unknown>;
}, builtins: Injectables, userAgents: Record<string, AgentDef>): {
    agents: string[];
    commands: string[];
};
//# sourceMappingURL=agent-injector.d.ts.map