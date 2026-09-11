// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { ReviewDraftStorage } from "./review-draft-storage";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("recovers quota by compacting existing drafts without changing any judgments", () => {
  const key = "beatmap-lens-review-draft:old";
  const old = { confidence: "high", rationale: "人类判断", notes: [1, 2, 3] };
  localStorage.setItem(key, JSON.stringify(old, null, 2));
  localStorage.setItem("unrelated", "  leave intact  ");
  const set = localStorage.setItem.bind(localStorage);
  vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (
      key.endsWith(":new") &&
      localStorage.getItem("beatmap-lens-review-draft:old")?.includes("\n")
    ) {
      throw new DOMException("Full", "QuotaExceededError");
    }
    set(key, value);
  });
  const drafts = new ReviewDraftStorage(() => localStorage);
  drafts.set("beatmap-lens-review-draft:new", { confidence: "low" });
  expect(localStorage.getItem(key)).toBe(JSON.stringify(old));
  expect(localStorage.getItem("unrelated")).toBe("  leave intact  ");
  expect(drafts.unsaved()).toEqual({});
  expect(JSON.parse(drafts.get("beatmap-lens-review-draft:new") ?? "null")).toEqual({
    confidence: "low",
  });
});

it("retains newer drafts by scope when storage stays full, then clears only a saved scope", () => {
  localStorage.setItem("a", '{"confidence":"low"}');
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  const drafts = new ReviewDraftStorage(() => localStorage);
  drafts.set("a", { confidence: "high" });
  drafts.set("b", { rationale: "pending" });
  expect(JSON.parse(drafts.get("a") ?? "null")).toEqual({ confidence: "high" });
  expect(drafts.unsaved()).toEqual({ a: { confidence: "high" }, b: { rationale: "pending" } });
  drafts.remove("a");
  expect(drafts.get("a")).toBeNull();
  expect(drafts.unsaved()).toEqual({ b: { rationale: "pending" } });
});
