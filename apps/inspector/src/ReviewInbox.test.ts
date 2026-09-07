// @vitest-environment happy-dom

import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import type {
  InboxClaimV2,
  InboxSourceV2,
  ReviewInboxV2,
} from "./annotation/workflow/remote-workspace";
import { reviewVersionOptions } from "./annotation/workflow/review-provenance";
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
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes(label) || button.getAttribute("aria-label") === label,
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
  it("keeps equal labels from different skill hashes and auditor versions distinct", async () => {
    const { source, claim } = await fixture();
    const agent = (hash: string) => ({
      producerId: hash,
      role: "labeler" as const,
      skill: { name: "judgment", version: "same-version-name", sha256: hash.repeat(64) },
    });
    const audit = (hash: string) => ({
      auditId: hash,
      agent: { ...agent(hash), role: "auditor" as const },
      createdAt: "2026-09-07T10:00:00Z",
      outcome: "supported" as const,
    });
    const input = {
      ...source,
      reviews: [
        claim("old", { agent: agent("a"), audits: [audit("a")] }),
        claim("new", { agent: agent("b"), audits: [audit("a")] }),
        claim("reaudited", { agent: agent("a"), audits: [audit("b")] }),
        claim("same-cohort", { agent: agent("a"), audits: [audit("a")] }),
      ],
    };
    expect(sampleCandidates([input], "", "all").map((x) => x.claim.claimId)).toEqual([
      "old",
      "new",
      "reaudited",
    ]);
    expect(
      sampleCandidates([input], "", "all", { labelerVersion: "b".repeat(64) }).map(
        (x) => x.claim.claimId,
      ),
    ).toEqual(["new"]);
    expect(
      sampleCandidates([input], "", "all", { auditorVersion: "b".repeat(64) }).map(
        (x) => x.claim.claimId,
      ),
    ).toEqual(["reaudited"]);
    expect(reviewVersionOptions(input.reviews, "labeler").map((x) => x.label)).toEqual([
      "same-version-name · aaaaaaaa",
      "same-version-name · bbbbbbbb",
    ]);
  });

  it("filters history and sampling by exact versions and opens superseded records", async () => {
    const { source, inbox, fetcher, claim } = await fixture();
    const agent = (hash: string) => ({
      producerId: `producer-${hash}`,
      role: "labeler" as const,
      skill: { name: "judgment", version: "same-name", sha256: hash.repeat(64) },
    });
    const history = claim("historical", {
      agent: agent("a"),
      status: "superseded",
      submittedAt: "2026-09-06T10:00:00Z",
    });
    const input = {
      ...inbox,
      sources: [
        {
          ...source,
          reviews: [
            history,
            claim("latest", { agent: agent("b"), submittedAt: "2026-09-07T10:00:00Z" }),
            claim("human", { agent: agent("a"), status: "modified" }),
          ],
        },
      ],
    };
    fetcher.mockImplementation(async (url) =>
      Response.json(
        url.endsWith("inbox")
          ? input
          : { document: { source: source.source }, version: source.version },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const { container } = mount();
    await vi.waitFor(() =>
      expect(container.querySelector('select[name="labelerVersion"]')?.children).toHaveLength(3),
    );
    await click(container, "Browse review history");
    await change(
      container.querySelector('select[name="labelerVersion"]') as HTMLSelectElement,
      "a".repeat(64),
    );
    expect(container.querySelectorAll(".inbox-history-list button")).toHaveLength(2);
    await change(
      container.querySelector('select[name="historyStatus"]') as HTMLSelectElement,
      "superseded",
    );
    const button = container.querySelector(".inbox-history-list button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("version aaaaaaaa");
    expect(button.textContent).not.toContain("Labeler");
    await click(container, "Show provenance");
    expect(button.textContent).toContain("same-name · aaaaaaaa");
    button.click();
    await vi.waitFor(() =>
      expect(container.querySelector("output")?.textContent).toContain('"claimId":"historical"'),
    );
    await click(container, "Inbox");
    await change(
      container.querySelector('select[name="labelerVersion"]') as HTMLSelectElement,
      "b".repeat(64),
    );
    await click(container, "Sample machine-reviewed sections");
    expect(container.querySelector("#review-history")).toBeNull();
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await nextTick();
    const saved = JSON.parse(
      localStorage.getItem(`beatmap-lens-review-sample:${inbox.workspace}`) ?? "{}",
    );
    expect(saved.labelerVersion).toBe("b".repeat(64));
    expect(saved.claims.map((x: { claimId: string }) => x.claimId)).toEqual(["latest"]);
    await change(
      container.querySelector('select[name="labelerVersion"]') as HTMLSelectElement,
      "a".repeat(64),
    );
    expect(container.querySelector(".inbox-sampler")?.textContent).toContain(
      "labeler same-name · bbbbbbbb",
    );
  });

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
    const selects = container.querySelectorAll("form select");
    await change(selects[0] as HTMLSelectElement, "tech");
    await change(selects[1] as HTMLSelectElement, "prominent");
    await change(container.querySelector("form input") as HTMLInputElement, "2");
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
