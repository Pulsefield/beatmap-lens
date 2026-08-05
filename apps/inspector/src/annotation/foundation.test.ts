import { describe, expect, it } from "vitest";
import { canonicalCatalogTagSeedsV1 } from "./foundation";

describe("catalog tag identity", () => {
  it("keeps raw display names while producing sorted canonical IDs", () => {
    expect(canonicalCatalogTagSeedsV1(["Tech", "Jump Stream", "Jump Stream"])).toEqual([
      { displayName: "Jump Stream", id: "jump-stream" },
      { displayName: "Tech", id: "tech" },
    ]);
  });

  it("rejects labels without a canonical ID", () => {
    expect(() => canonicalCatalogTagSeedsV1(["---"])).toThrow(/has no canonical tag ID/);
  });

  it("rejects distinct labels that resolve to the same canonical ID", () => {
    expect(() => canonicalCatalogTagSeedsV1(["Jump Stream", "jump-stream"])).toThrow(
      /share canonical tag ID jump-stream/,
    );
  });
});
