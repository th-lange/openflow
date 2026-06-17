/**
 * Parses the last ```openflow ... ``` fenced block in a text string.
 * Returns the parsed JSON object, or null if no block exists or the content is
 * not a valid JSON object. Never throws.
 */
export function parseOpenflowBlock(text: string): Record<string, unknown> | null {
  const pattern = /```openflow\s*([\s\S]*?)```/g;
  let lastContent: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    lastContent = m[1].trim();
  }
  if (lastContent === null) return null;
  try {
    const parsed = JSON.parse(lastContent);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
