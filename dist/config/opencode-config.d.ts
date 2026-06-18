export type ConfigPaths = {
    read: string;
    write: string;
};
/**
 * Resolve which `opencode` config file to read from and write to in `dir`.
 * Prefers `opencode.jsonc` (OpenCode's primary format) over `opencode.json`.
 * Reads and writes the same file; never creates a sibling of the other type.
 * When neither exists, targets `opencode.json`.
 *
 * Mirrors the resolution in `bin/openflow.mjs` so the installer and the
 * runtime tools agree on which file they touch.
 */
export declare function resolveConfigPath(dir: string): Promise<ConfigPaths>;
/** Read raw file contents, or `""` if the file does not exist. */
export declare function readConfigText(path: string): Promise<string>;
/**
 * Parse an opencode config file (JSON or JSONC) into a plain object.
 * Tolerates comments and trailing commas. Returns `{}` for a missing or
 * empty/invalid file.
 */
export declare function readConfigObject(path: string): Promise<Record<string, unknown>>;
/**
 * Set a value at `path` (e.g. `["agent", "documenter"]`) in a config file,
 * preserving comments, key order, and formatting of everything else.
 * Pass `value: undefined` to delete the key. Creates the file (and parent
 * directories) if it does not exist.
 */
export declare function setConfigValue(filePath: string, path: (string | number)[], value: unknown): Promise<void>;
/** Apply several `[path, value]` edits in one read/write, preserving formatting. */
export declare function setConfigValues(filePath: string, updates: Array<{
    path: (string | number)[];
    value: unknown;
}>): Promise<void>;
//# sourceMappingURL=opencode-config.d.ts.map