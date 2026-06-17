import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseOpenflowBlock } from "../utils/openflow-block.js";

describe("parseOpenflowBlock", () => {
  it("returns null when no openflow block is present", () => {
    assert.equal(parseOpenflowBlock("No block here."), null);
  });

  it("parses a simple block", () => {
    const text = 'Some prose.\n```openflow\n{"verdict":"PASS"}\n```\nMore prose.';
    assert.deepEqual(parseOpenflowBlock(text), { verdict: "PASS" });
  });

  it("returns the last block when multiple are present", () => {
    const text = [
      '```openflow\n{"verdict":"FAIL"}\n```',
      "Some text in between.",
      '```openflow\n{"verdict":"PASS","feedback":"looks good"}\n```',
    ].join("\n");
    const result = parseOpenflowBlock(text);
    assert.deepEqual(result, { verdict: "PASS", feedback: "looks good" });
  });

  it("returns null for malformed JSON", () => {
    const text = '```openflow\n{not valid json\n```';
    assert.equal(parseOpenflowBlock(text), null);
  });

  it("returns null when block contains a JSON array", () => {
    const text = '```openflow\n["a","b"]\n```';
    assert.equal(parseOpenflowBlock(text), null);
  });

  it("returns null when block contains a JSON primitive", () => {
    const text = '```openflow\n"PASS"\n```';
    assert.equal(parseOpenflowBlock(text), null);
  });

  it("tolerates whitespace around the JSON", () => {
    const text = '```openflow\n\n  { "route": "bug" }  \n\n```';
    assert.deepEqual(parseOpenflowBlock(text), { route: "bug" });
  });

  it("handles blocks with nested objects", () => {
    const text = '```openflow\n{"status":"CONTINUE","next":"coder"}\n```';
    assert.deepEqual(parseOpenflowBlock(text), { status: "CONTINUE", next: "coder" });
  });
});
