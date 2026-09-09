// @vitest-environment happy-dom

import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, shallowRef } from "vue";
import { FakeDirectoryHandle } from "./annotation/test-helpers";
import { WorkflowDirectoryV2 } from "./annotation/workflow/directory";
import { sealHandoffV2 } from "./annotation/workflow/domain";
import type { RemoteSourceV2 } from "./annotation/workflow/remote-workspace";
import { skillKey } from "./annotation/workflow/review-provenance";
import { NOW, workflowFixture } from "./annotation/workflow/test-fixtures";
import ReviewWorkspace from "./ReviewWorkspace.vue";

vi.mock("./annotation/session-store", () => ({
  IndexedDbSessionStore: class {
    async getPreferences() {
      return undefined;
    }
    async setPreferences() {}
  },
}));

const apps: ReturnType<typeof createApp>[] = [];
const appErrors: unknown[] = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.replaceChildren();
  localStorage.clear();
  expect(appErrors.splice(0)).toEqual([]);
});

async function historySource(title: string, revisions: string[]): Promise<RemoteSourceV2> {
  const f = await workflowFixture();
  const bytes = new TextEncoder().encode(
    new TextDecoder().decode(f.sourceBytes).replace("Title: Workflow fixture", `Title: ${title}`),
  );
  const directory = new WorkflowDirectoryV2(new FakeDirectoryHandle(title));
  const initial = await directory.initialize(bytes, f.foundation);
  const approved = await directory.approveFoundation(bytes, initial.version, "fixture-human");
  const exported = await directory.exportTask(bytes, approved.version);
  let current = exported.stored;
  for (const revision of revisions) {
    const handoff = await sealHandoffV2(exported.task, {
      handoffId: `${title}-${revision}`,
      createdAt: NOW,
      agent: {
        producerId: `labeler-${revision}`,
        role: "labeler",
        skill: { name: "judgment", version: revision, sha256: "a".repeat(64) },
      },
      proposals: [f.claim],
      audit: [],
      questions: [],
    });
    current = (await directory.importHandoff(bytes, current.version, handoff)).stored;
  }
  return { ...current, sourceBytes: Array.from(bytes) };
}

function mount(remoteSource: RemoteSourceV2) {
  const remote = shallowRef(remoteSource);
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp({ render: () => h(ReviewWorkspace, { remoteSource: remote.value }) });
  app.config.errorHandler = (error) => appErrors.push(error);
  apps.push(app);
  app.mount(container);
  return { container, remote };
}

async function selectVersion(container: HTMLElement, key: string) {
  const select = container.querySelector<HTMLSelectElement>(".review-all-agent-work select");
  assert(select);
  select.value = key;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await nextTick();
  return select;
}

describe("connected chart review history", () => {
  it("exposes every same-content revision and opens the selected historical proposal", async () => {
    const source = await historySource("First chart", [
      "fine-harness-v1",
      "fine-harness-v2",
      "fine-harness-v3",
    ]);
    const before = JSON.stringify(source.document);
    const { container } = mount(source);
    await vi.waitFor(() =>
      expect(container.querySelectorAll(".review-all-agent-work select option")).toHaveLength(4),
    );
    const history = container.querySelector<HTMLDetailsElement>(".review-all-agent-work");
    assert(history);
    expect(history.querySelector("summary")?.textContent).toContain("Review history · 3 claims");
    expect(history.querySelector("label")?.textContent).toContain("History labeler version");
    const selectedAgent = source.document.handoffs[1]?.handoff.agent;
    assert(selectedAgent);
    await selectVersion(container, skillKey(selectedAgent));
    const entries = history.querySelectorAll(".review-handoff");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.textContent).toContain("judgment · fine-harness-v2 · aaaaaaaa");
    entries[0]?.querySelector<HTMLButtonElement>(".review-list-row")?.click();
    await vi.waitFor(() =>
      expect(container.querySelector(".review-audit-result")?.textContent).toContain(
        "fine-harness-v2",
      ),
    );
    expect(JSON.stringify(source.document)).toBe(before);
  });

  it("clears the previous chart version filter when another connected chart opens", async () => {
    const first = await historySource("First chart", ["v1", "v2"]);
    const second = await historySource("Second chart", ["v3"]);
    const { container, remote } = mount(first);
    await vi.waitFor(() =>
      expect(container.querySelectorAll(".review-all-agent-work select option")).toHaveLength(3),
    );
    const selectedAgent = first.document.handoffs[0]?.handoff.agent;
    assert(selectedAgent);
    await selectVersion(container, skillKey(selectedAgent));
    expect(container.querySelectorAll(".review-handoff")).toHaveLength(1);
    remote.value = second;
    await vi.waitFor(() =>
      expect(container.querySelectorAll(".review-all-agent-work select option")).toHaveLength(2),
    );
    expect(container.querySelector<HTMLSelectElement>(".review-all-agent-work select")?.value).toBe(
      "",
    );
    expect(container.querySelectorAll(".review-handoff")).toHaveLength(1);
    expect(container.querySelector(".review-handoff")?.textContent).toContain(
      "judgment · v3 · aaaaaaaa",
    );
    expect(first.document.decisions).toEqual([]);
    expect(second.document.decisions).toEqual([]);
  });
});
