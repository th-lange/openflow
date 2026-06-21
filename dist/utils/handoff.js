// Structured handoffs (#64).
//
// Agents end their response with a fenced ```handoff block — a compact summary
// of what they decided, which files they touched, and what's next. When threading
// one step's output into the next, the engine threads that block rather than the
// full transcript: downstream agents re-read the named files via their own tools
// instead of receiving them inline. This is the default ("compact") path; a
// workflow can opt back into full-output threading via `compactContext: false`.
/** Output longer than this is truncated when no handoff block is present. */
export const HANDOFF_FALLBACK_LIMIT = 1200;
/**
 * Extract the inner text of the last ```handoff fenced block, or null when the
 * text contains none. Mirrors the ```openflow block convention. Never throws.
 */
export function extractHandoff(text) {
    const pattern = /```handoff\s*([\s\S]*?)```/g;
    let last = null;
    let m;
    while ((m = pattern.exec(text)) !== null)
        last = m[1].trim();
    return last && last.length > 0 ? last : null;
}
/**
 * Compact a step's output for threading into the next step: the handoff block if
 * the agent emitted one, otherwise the raw output bounded to HANDOFF_FALLBACK_LIMIT
 * so a handoff-less agent can't reintroduce the O(n²) blow-up. The truncation note
 * tells the next agent to re-read source files for detail.
 */
export function compactForThread(text) {
    const handoff = extractHandoff(text);
    if (handoff !== null)
        return handoff;
    if (text.length <= HANDOFF_FALLBACK_LIMIT)
        return text;
    const dropped = text.length - HANDOFF_FALLBACK_LIMIT;
    return (text.slice(0, HANDOFF_FALLBACK_LIMIT) +
        `\n…[truncated ${dropped} chars — re-read the source files for detail]`);
}
//# sourceMappingURL=handoff.js.map