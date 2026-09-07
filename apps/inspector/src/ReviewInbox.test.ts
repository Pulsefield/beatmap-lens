// @vitest-environment happy-dom

import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import type {
  InboxClaimV2,
  InboxSourceV2,
  ReviewInboxV2,
} from "./annotation/workflow/remote-workspace";
import {
  drawReviewSample,
  sampleCandidates,
  sampleKey,
} from "./annotation/workflow/review-sampling";
import { workflowFixture } from "./annotation/workflow/test-fixtures";
import ReviewInbox from "./ReviewInbox.vue";

vi.mock("./ReviewWorkspace.vue", () => ({
  default: defineComponent({
    props: ["openClaim"],
    emits: ["saved", "back-to-inbox"],
    setup:
      (props, { emit }) =>
      () =>
        h("div", { class: "test-review" }, [
          h("output", JSON.stringify(props.openClaim)),
          h("button", { onClick: () => emit("saved") }, "Save test judgment"),
        ]),
  }),
}));

const apps: ReturnType<typeof createApp>[] = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function fixture() {
  const f = await workflowFixture();
  const claim = (claimId: string, changes: Partial<InboxClaimV2> = {}): InboxClaimV2 => ({
    handoffId: "handoff",
    claimId,
    tagId: "tech",
    scope: { startMs: 1000, endMs: 1800 },
    status: "agent-reviewed",
    rationale: "Reviewed evidence",
    assessment: { presence: "present", salience: "prominent" },
    ...changes,
  });
  const source: InboxSourceV2 = {
    source: f.inspected.source,
    version: { revision: 1, sha256: "a".repeat(64) },
    counts: { "agent-reviewed": 3, total: 3 },
    requests: [],
    expertQueue: [],
    reviews: [
      claim("one"),
      claim("two", { scope: { startMs: 800, endMs: 1500 } }),
      claim("negative", { assessment: { presence: "absent" } }),
    ],
  };
  const inbox: ReviewInboxV2 = { workspace: "/review-fixture", sources: [source], receipts: [] };
  const fetcher = vi.fn(async (input: string) =>
    Response.json(
      input.endsWith("inbox")
        ? inbox
        : {
            document: { source: source.source },
            version: source.version,
          },
    ),
  );
  return { claim, source, inbox, fetcher };
}

function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp(ReviewInbox);
  apps.push(app);
  app.mount(container);
  return { app, container };
}

async function click(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(label),
  );
  expect(button).toBeDefined();
  button?.click();
  await nextTick();
}

async function change(control: HTMLInputElement | HTMLSelectElement, value: string) {
  control.value = value;
  control.dispatchEvent(
    new Event(control.tagName === "INPUT" ? "input" : "change", { bubbles: true }),
  );
  await nextTick();
}

describe("machine review sampling", () => {
  it("visits unsaved samples in order and reports failed cross-chart loads in the active view", async () => {
    const { inbox, source, fetcher } = await fixture();
    const sources = source.reviews.map((claim, index) => ({
      ...source,
      source: { ...source.source, sha256: `${index}`.repeat(64) },
      reviews: [claim],
    }));
    const input = { ...inbox, sources };
    let failedSource = "";
    fetcher.mockImplementation(async (url) => {
      if (url.endsWith("inbox")) return Response.json(input);
      if (url.endsWith(failedSource) && failedSource) throw new Error("Could not load next chart");
      const current = sources.find((item) => url.endsWith(item.source.sha256));
      assert(current);
      return Response.json({ document: { source: current.source }, version: current.version });
    });
    vi.stubGlobal("fetch", fetcher);
    const { container } = mount();
    await vi.waitFor(() => expect(container.textContent).toContain("9 machine-reviewed"));
    await click(container, "Sample machine-reviewed sections");
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await nextTick();
    const saved = localStorage.getItem(`beatmap-lens-review-sample:${inbox.workspace}`);
    assert(saved);
    const batch = JSON.parse(saved);
    (container.querySelector(".inbox-sample-list button") as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(container.querySelector("output")?.textContent).toContain(batch.claims[0].claimId),
    );
    await click(container, "Next sample");
    await vi.waitFor(() =>
      expect(container.querySelector("output")?.textContent).toContain(batch.claims[1].claimId),
    );
    failedSource = batch.claims[2].sourceSha256;
    await click(container, "Next sample");
    await vi.waitFor(() =>
      expect(container.querySelector(".inbox-active [role='alert']")?.textContent).toContain(
        "Could not load next chart",
      ),
    );
    expect(container.querySelector("output")?.textContent).toContain(batch.claims[1].claimId);
    failedSource = "";
    await click(container, "Next sample");
    await vi.waitFor(() =>
      expect(container.querySelector("output")?.textContent).toContain(batch.claims[2].claimId),
    );
    expect(container.querySelector(".inbox-active [role='alert']")).toBeNull();
  });

  it("filters by tag and strength and excludes human, stale, superseded and already requested work", async () => {
    const { source, claim } = await fixture();
    const input = {
      ...source,
      reviews: [
        ...source.reviews,
        claim("ln", { tagId: "ln-coordination" }),
        claim("human", { status: "modified" }),
        claim("old", { status: "superseded" }),
        claim("stale", { status: "stale" }),
        claim("requested"),
        claim("repeated", { handoffId: "second-submission" }),
        claim("different-strength", {
          assessment: { presence: "present", salience: "supporting" },
        }),
      ],
      requests: [
        {
          requestId: "request",
          handoffId: "handoff",
          claimIds: ["requested"],
          pendingClaimIds: ["requested"],
          reason: "spot-check",
          question: "Review",
        },
      ],
    };
    expect(
      sampleCandidates([input], "tech", "prominent").map((item) => item.claim.claimId),
    ).toEqual(["one", "two"]);
    expect(sampleCandidates([input], "tech", "absent").map((item) => item.claim.claimId)).toEqual([
      "negative",
    ]);
    const candidates = sampleCandidates([input], "", "all");
    const sample = drawReviewSample(candidates, 3, () => 0.5);
    expect(sample).toHaveLength(3);
    expect(new Set(sample.map(sampleKey)).size).toBe(3);
    expect(drawReviewSample(candidates, 100)).toHaveLength(5);
  });

  it("retains a bounded batch across reload, opens exact claims, and reads human changes before advancing", async () => {
    const { inbox, source, fetcher } = await fixture();
    vi.stubGlobal("fetch", fetcher);
    let { app, container } = mount();
    await vi.waitFor(() => expect(container.textContent).toContain("3 machine-reviewed"));
    await click(container, "Sample machine-reviewed sections");
    const selects = container.querySelectorAll("select");
    await change(selects[0] as HTMLSelectElement, "tech");
    await change(selects[1] as HTMLSelectElement, "prominent");
    await change(container.querySelector("input") as HTMLInputElement, "2");
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await nextTick();
    expect(container.querySelectorAll(".inbox-sample-list button")).toHaveLength(2);
    expect(fetcher.mock.calls.every(([url]) => url.endsWith("inbox"))).toBe(true);
    const saved = localStorage.getItem(`beatmap-lens-review-sample:${inbox.workspace}`);
    assert(saved);
    const batch = JSON.parse(saved);
    app.unmount();
    apps.splice(apps.indexOf(app), 1);
    container.remove();
    ({ app, container } = mount());
    await vi.waitFor(() =>
      expect(container.querySelectorAll(".inbox-sample-list button")).toHaveLength(2),
    );
    (container.querySelector(".inbox-sample-list button") as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(container.querySelector("output")?.textContent).toContain(batch.claims[0].claimId),
    );
    const modified = source.reviews.find((claim) => claim.claimId === batch.claims[0].claimId);
    assert(modified);
    Object.assign(modified, {
      status: "modified",
      assessment: { presence: "present", salience: "supporting" },
    });
    await click(container, "Save test judgment");
    await vi.waitFor(() => expect(container.textContent).toContain("Sample · 1/2"));
    await click(container, "Next sample");
    await vi.waitFor(() =>
      expect(container.querySelector("output")?.textContent).toContain(batch.claims[1].claimId),
    );
    const stale = source.reviews.find((claim) => claim.claimId === batch.claims[1].claimId);
    assert(stale);
    Object.assign(stale, { status: "stale" });
    await click(container, "Save test judgment");
    await vi.waitFor(() =>
      expect(container.querySelector(".inbox-sample-list")?.textContent).toContain(
        "Awaiting agent reread",
      ),
    );
    expect(
      (container.querySelectorAll(".inbox-sample-list button")[1] as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
