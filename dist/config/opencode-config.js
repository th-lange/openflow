import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { parse, modify, applyEdits } from "jsonc-parser";
// Shared OpenCode config plumbing.
//
// OpenCode's primary config format is JSONC (comments + trailing commas).
// Reading must tolerate that, and writing must preserve comments/formatting —
// hence jsonc-parser's `modify`/`applyEdits` rather than JSON.stringify, which
// would strip every comment and reflow the whole file. See #35, #36.
const FORMATTING = { tabSize: 2, insertSpaces: true, eol: "\n" };
async function fileExists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Resolve which `opencode` config file to read from and write to in `dir`.
 * Prefers `opencode.jsonc` (OpenCode's primary format) over `opencode.json`.
 * Reads and writes the same file; never creates a sibling of the other type.
 * When neither exists, targets `opencode.json`.
 *
 * Mirrors the resolution in `bin/openflow.mjs` so the installer and the
 * runtime tools agree on which file they touch.
 */
export async function resolveConfigPath(dir) {
    const jsoncPath = resolve(dir, "opencode.jsonc");
    const jsonPath = resolve(dir, "opencode.json");
    if (await fileExists(jsoncPath))
        return { read: jsoncPath, write: jsoncPath };
    if (await fileExists(jsonPath))
        return { read: jsonPath, write: jsonPath };
    return { read: jsonPath, write: jsonPath };
}
/** Read raw file contents, or `""` if the file does not exist. */
export async function readConfigText(path) {
    try {
        return await readFile(path, "utf-8");
    }
    catch (e) {
        if (e?.code === "ENOENT")
            return "";
        throw new Error(`Failed to read ${path}: ${e?.message ?? e}`);
    }
}
/**
 * Parse an opencode config file (JSON or JSONC) into a plain object.
 * Tolerates comments and trailing commas. Returns `{}` for a missing or
 * empty/invalid file.
 */
export async function readConfigObject(path) {
    const text = await readConfigText(path);
    if (!text.trim())
        return {};
    const errors = [];
    const parsed = parse(text, errors, { allowTrailingComma: true });
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        return {};
    return parsed;
}
/**
 * Set a value at `path` (e.g. `["agent", "documenter"]`) in a config file,
 * preserving comments, key order, and formatting of everything else.
 * Pass `value: undefined` to delete the key. Creates the file (and parent
 * directories) if it does not exist.
 */
export async function setConfigValue(filePath, path, value) {
    const current = (await readConfigText(filePath)) || "{}\n";
    const edits = modify(current, path, value, { formattingOptions: FORMATTING });
    const next = applyEdits(current, edits);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, next.endsWith("\n") ? next : next + "\n", "utf-8");
}
/** Apply several `[path, value]` edits in one read/write, preserving formatting. */
export async function setConfigValues(filePath, updates) {
    let current = (await readConfigText(filePath)) || "{}\n";
    for (const { path, value } of updates) {
        const edits = modify(current, path, value, { formattingOptions: FORMATTING });
        current = applyEdits(current, edits);
    }
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, current.endsWith("\n") ? current : current + "\n", "utf-8");
}
//# sourceMappingURL=opencode-config.js.map