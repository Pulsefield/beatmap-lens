import { describe, expect, it } from "vitest";
import { serializeCanonicalJson } from "../canonical-json";
import { decodeReviewResponse, encodeReviewResponse } from "./review-transport";
import { workflowFixture } from "./test-fixtures";

describe("Review HTTP transport", () => {
  it("shares repeated snapshots without changing any canonical bytes or task hashes", async () => {
    const f = await workflowFixture();
    const original = { document: f.registered, sourceBytes: Array.from(f.sourceBytes) };
    const canonical = serializeCanonicalJson(original);
    const encoded = encodeReviewResponse(original);
    const decoded = decodeReviewResponse<typeof original>(JSON.parse(encoded));
    expect(serializeCanonicalJson(decoded)).toBe(canonical);
    expect(decoded.document.tasks[0]?.foundation).toBe(decoded.document.foundation);
    expect(decoded.document.tasks[0]?.sourceBytes).toBe(decoded.sourceBytes);
    expect(encoded.length).toBeLessThan(JSON.stringify(original).length);
    expect(serializeCanonicalJson(original)).toBe(canonical);
  });

  it("keeps distinct snapshots distinct and reads ordinary API replies", () => {
    const original = { foundation: { version: 1 }, tasks: [{ foundation: { version: 2 } }] };
    expect(decodeReviewResponse(JSON.parse(encodeReviewResponse(original)))).toEqual(original);
    expect(decodeReviewResponse({ error: "Conflict" })).toEqual({ error: "Conflict" });
  });
});
