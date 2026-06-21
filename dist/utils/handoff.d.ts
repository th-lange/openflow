/** Output longer than this is truncated when no handoff block is present. */
export declare const HANDOFF_FALLBACK_LIMIT = 1200;
/**
 * Extract the inner text of the last ```handoff fenced block, or null when the
 * text contains none. Mirrors the ```openflow block convention. Never throws.
 */
export declare function extractHandoff(text: string): string | null;
/**
 * Compact a step's output for threading into the next step: the handoff block if
 * the agent emitted one, otherwise the raw output bounded to HANDOFF_FALLBACK_LIMIT
 * so a handoff-less agent can't reintroduce the O(n²) blow-up. The truncation note
 * tells the next agent to re-read source files for detail.
 */
export declare function compactForThread(text: string): string;
//# sourceMappingURL=handoff.d.ts.map