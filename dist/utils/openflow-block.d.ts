/**
 * Parses the last ```openflow ... ``` fenced block in a text string.
 * Returns the parsed JSON object, or null if no block exists or the content is
 * not a valid JSON object. Never throws.
 */
export declare function parseOpenflowBlock(text: string): Record<string, unknown> | null;
//# sourceMappingURL=openflow-block.d.ts.map