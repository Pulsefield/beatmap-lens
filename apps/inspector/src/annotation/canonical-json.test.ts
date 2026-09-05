import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { serializeCanonicalJson, sha256Hex } from "./canonical-json";

describe("canonical JSON source arrays", () => {
  it("preserves canonical bytes and SHA for a large immutable source byte array", async () => {
    const sourceBytes = Object.freeze(Array.from({ length: 250_000 }, (_, index) => index % 256));
    const value = Object.freeze({
      title: "源谱面",
      sourceBytes,
      range: { startMs: 0, endMs: 1000 },
    });
    const expected = `${JSON.stringify({ range: { endMs: 1000, startMs: 0 }, sourceBytes, title: "源谱面" }, null, 2)}\n`;
    expect(serializeCanonicalJson(value)).toBe(expected);
    const expectedSha = createHash("sha256").update(expected).digest("hex");
    expect(await sha256Hex(expected)).toBe(expectedSha);
    expect(await sha256Hex(new TextEncoder().encode(expected))).toBe(expectedSha);
    expect(sourceBytes[249_999]).toBe(143);
  });

  it("continues rejecting non-finite values inside numeric source arrays", () => {
    expect(() => serializeCanonicalJson({ sourceBytes: [0, 1, Number.NaN] })).toThrow("non-finite");
  });
});
