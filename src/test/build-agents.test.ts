import { describe, it } from "node:test";
import assert from "node:assert/strict";
// The generator is plain ESM in scripts/; tsc excludes src/test so the .mjs
// import is fine at runtime under tsx.
// @ts-ignore - no type declarations for the script module
import { parseAgentFile } from "../../scripts/build-agents.mjs";

describe("build-agents parseAgentFile", () => {
  it("parses the metadata block and prompt body", () => {
    const text = `<!-- openflow-agent
{
  "description": "A test agent.",
  "mode": "subagent",
  "tools": {}
}
-->

You are a test agent.

## Rules
Be terse.`;
    const { meta, prompt } = parseAgentFile(text);
    assert.equal(meta.description, "A test agent.");
    assert.equal(meta.mode, "subagent");
    assert.deepEqual(meta.tools, {});
    assert.equal(prompt, "You are a test agent.\n\n## Rules\nBe terse.");
    assert.equal("prompt" in meta, false, "prompt is not part of meta");
  });

  it("throws when the metadata block is missing", () => {
    assert.throws(() => parseAgentFile("Just a prompt, no metadata."), /metadata block/);
  });

  it("throws when the metadata block is not valid JSON", () => {
    assert.throws(
      () => parseAgentFile("<!-- openflow-agent\n{ not json }\n-->\nbody"),
      /not valid JSON/
    );
  });

  it("throws when the prompt body is empty", () => {
    assert.throws(
      () => parseAgentFile(`<!-- openflow-agent\n{ "mode": "subagent" }\n-->\n   `),
      /prompt body is empty/
    );
  });
});
