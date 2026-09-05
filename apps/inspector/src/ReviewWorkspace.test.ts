// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, shallowRef } from "vue";
import { FakeDirectoryHandle } from "./annotation/test-helpers";
import type { ClaimV2, FoundationV2 } from "./annotation/workflow/contracts";
import { WorkflowDirectoryV2 } from "./annotation/workflow/directory";
import {
  addHumanObservationV2,
  reviewDocumentVersionV2,
  sealAuditV2,
  sealHandoffV2,
} from "./annotation/workflow/domain";
import type { RemoteSourceV2 } from "./annotation/workflow/remote-workspace";
import { historicalAcceptance, NOW, workflowFixture } from "./annotation/workflow/test-fixtures";
import ReviewWorkspace from "./ReviewWorkspace.vue";

const picker = vi.hoisted(() => vi.fn());
vi.mock("./annotation/file-system-access", () => ({ pickDatasetDirectory: picker }));
const apps: ReturnType<typeof createApp>[] = [];
const appErrors: unknown[] = [];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.replaceChildren();
  localStorage.clear();
  picker.mockReset();
  expect(appErrors.splice(0)).toEqual([]);
});

describe("ReviewWorkspace mounted workflow", () => {
  it("routes an unresolved inbox proposal through an explicit assessment instead of Accept original", async () => {
    const f = await workspaceFixture(true);
    if (!f.handoff) throw new Error("Missing handoff.");
    const current = await f.read();
    if (!current) throw new Error("Missing review.");
    const imported = await f.directory.importHandoff(f.sourceBytes, current.version, f.handoff);
    const container = document.createElement("div");
    document.body.append(container);
    const app = createApp(ReviewWorkspace, {
      remoteSource: { ...imported.stored, sourceBytes: Array.from(f.sourceBytes) },
      openClaim: { handoffId: f.handoff.handoffId, claimId: "claim-c" },
    });
    app.config.errorHandler = (error) => appErrors.push(error);
    apps.push(app);
    app.mount(container);
    await vi.waitFor(() =>
      expect(container.textContent).toContain("This proposal does not decide presence"),
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (node) => node.textContent === "Accept original",
      ),
    ).toBe(false);
    await click(container, "Decide judgment");
    await setValue(
      control(container, "Human decision rationale"),
      "The scoped pattern is present, supporting.",
      "input",
    );
    expect(button(container, "Save modified").disabled).toBe(true);
    await setValue(control(container, "Assessment"), "present");
    await setValue(control(container, "Salience"), "supporting");
    expect(
      [...container.querySelectorAll("button")].some(
        (node) => node.textContent === "Accept original",
      ),
    ).toBe(false);
    const requests: unknown[] = [];
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      requests.push(body);
      const saved = await f.directory.decide(f.sourceBytes, body.expectedBase, body.input);
      return new Response(JSON.stringify(saved), { status: 200 });
    });
    try {
      await click(container, "Save modified");
      expect(requests).toHaveLength(1);
      expect((await f.read())?.document.decisions[0]?.disposition).toBe("modified");
      expect((await f.read())?.document.observations[0]?.claim.assessment).toEqual({
        presence: "present",
        salience: "supporting",
      });
    } finally {
      request.mockRestore();
    }
  });

  it("distinguishes a historical uncertain acceptance from its later direct human clarification", async () => {
    const f = await workspaceFixture(true);
    if (!f.handoff) throw new Error("Missing handoff.");
    const current = await f.read();
    if (!current) throw new Error("Missing review.");
    const imported = await f.directory.importHandoff(f.sourceBytes, current.version, f.handoff);
    const historical = historicalAcceptance(
      imported.stored.document,
      f.handoff.handoffId,
      "claim-c",
    );
    const original = historical.observations[0]?.claim;
    if (!original) throw new Error("Missing historical claim.");
    const clarified = await addHumanObservationV2(
      historical,
      {
        claim: { ...original, assessment: { presence: "present", salience: "supporting" } },
        humanId: "fixture-human",
        now: () => "2026-09-05T01:00:00.000Z",
      },
      f.sourceBytes,
    );
    const container = document.createElement("div");
    document.body.append(container);
    const app = createApp(ReviewWorkspace, {
      remoteSource: {
        document: clarified,
        version: await reviewDocumentVersionV2(clarified),
        sourceBytes: Array.from(f.sourceBytes),
      },
      openClaim: { handoffId: f.handoff.handoffId, claimId: "claim-c" },
    });
    app.config.errorHandler = (error) => appErrors.push(error);
    apps.push(app);
    app.mount(container);
    await vi.waitFor(() =>
      expect(container.textContent).toContain("This historical acceptance kept unresolved"),
    );
    expect(container.textContent).toContain("Later direct human judgment: present · supporting");
    expect(container.textContent).toContain("accepted · unresolved");
    expect(
      [...container.querySelectorAll("button")].some((node) =>
        ["Accept original", "Save modified", "Decide judgment"].includes(node.textContent ?? ""),
      ),
    ).toBe(false);
    await click(container, "View human clarification");
    expect(control(container, "Assessment").value).toBe("present");
    expect(control(container, "Salience").value).toBe("supporting");
    expect(control(container, "Assessment").disabled).toBe(true);
  });

  it("preserves a human draft when an independent audit arrives through the connected inbox", async () => {
    const f = await workspaceFixture(true);
    if (!f.task || !f.handoff) throw new Error("Fixture needs a task.");
    const initial = await f.read();
    if (!initial) throw new Error("Fixture needs a workspace.");
    const imported = await f.directory.importHandoff(f.sourceBytes, initial.version, f.handoff);
    const remote = shallowRef<RemoteSourceV2>({
      ...imported.stored,
      sourceBytes: Array.from(f.sourceBytes),
    });
    const container = document.createElement("div");
    document.body.append(container);
    const app = createApp({ render: () => h(ReviewWorkspace, { remoteSource: remote.value }) });
    app.config.errorHandler = (error) => appErrors.push(error);
    apps.push(app);
    app.mount(container);
    await vi.waitFor(() =>
      expect(container.querySelector(".claim-fields legend")?.textContent).toBe("Synthetic A"),
    );
    expect(container.textContent).not.toContain("Choose workspace folder");
    expect(container.textContent).not.toContain("Import agent handoff");
    await setValue(control(container, "Human reviewer"), "human-ui", "input");
    await setValue(
      control(container, "Evidence / judgment rationale"),
      "Keep my draft while the agent works.",
      "input",
    );
    await setValue(control(container, "Source time"), "1200", "input");
    const audit = await sealAuditV2(f.task, f.handoff, {
      auditId: "arriving-audit",
      createdAt: NOW,
      agent: { producerId: "parallel-auditor", role: "auditor" },
      claims: f.handoff.proposals.map((claim) =>
        claim.assessment.presence === "unresolved"
          ? {
              claimId: claim.id,
              outcome: "needs-expert",
              rationale: "Unresolved synthetic rule.",
              expertReason: "semantic-boundary",
              question: "Which interpretation applies?",
            }
          : { claimId: claim.id, outcome: "supported", rationale: "Source reviewed." },
      ),
      questions: [
        {
          questionId: "synthetic-question",
          disposition: "needs-expert",
          rationale: "Expert rule needed.",
        },
      ],
    });
    const arrived = await f.directory.importAudit(f.sourceBytes, imported.stored.version, audit);
    remote.value = { ...arrived.stored, sourceBytes: remote.value.sourceBytes };
    await nextTick();
    expect(control(container, "Evidence / judgment rationale").value).toBe(
      "Keep my draft while the agent works.",
    );
    expect(control(container, "Source time").value).toBe("1200");
    expect(container.textContent).not.toContain("earlier saved human review");
    expect(button(container, "Save section judgments").disabled).toBe(false);
    expect(arrived.stored.document.observations).toEqual([]);
  });

  it("keeps routine independent review separate from the focused expert queue and human decisions", async () => {
    const f = await workspaceFixture(true);
    if (!f.task || !f.handoff) throw new Error("Fixture needs a frozen task.");
    const audit = await sealAuditV2(f.task, f.handoff, {
      auditId: "independent-ui-audit",
      createdAt: NOW,
      agent: { producerId: "independent-reviewer", role: "auditor" },
      claims: [
        { claimId: "claim-a", outcome: "supported", rationale: "Source witnesses support A." },
        {
          claimId: "claim-b",
          outcome: "supported",
          rationale: "Source witnesses independently support B.",
        },
        {
          claimId: "claim-c",
          outcome: "needs-expert",
          rationale: "The frozen rule does not resolve this synthetic distinction.",
          expertReason: "semantic-boundary",
          question: "Which synthetic interpretation should remain unresolved?",
        },
      ],
      questions: [
        {
          questionId: "synthetic-question",
          disposition: "needs-expert",
          rationale: "The expert must settle this distinction.",
        },
      ],
    });
    const { container, app } = await openWorkspace(f);
    await upload(container, "Import agent handoff", jsonFile(f.handoff, "handoff.json"));
    await upload(container, "Import independent audit", jsonFile(audit, "audit.json"));
    expect(container.textContent).toContain("Expert review · 1");
    expect(container.textContent).toContain("2 agent-reviewed");
    expect(container.querySelector(".claim-fields legend")?.textContent).toBe("Synthetic C");
    expect(container.querySelector(".review-audit-result")?.textContent).toContain(
      audit.claims[2]?.rationale,
    );
    expect(container.querySelector<HTMLDetailsElement>(".review-all-agent-work")?.open).toBe(false);
    const reviewed = await f.read();
    expect(reviewed?.document.decisions).toEqual([]);
    expect(reviewed?.document.observations).toEqual([]);
    await setValue(control(container, "Human reviewer"), "human-ui", "input");
    await setValue(
      control(container, "Human decision rationale"),
      "Leave this specific question open.",
      "input",
    );
    await click(container, "Defer");
    await vi.waitFor(() => expect(container.textContent).toContain("Expert review · 0"));
    await upload(container, "Import independent audit", jsonFile(audit, "audit-again.json"));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("duplicate");
    expect((await f.read())?.document.decisions).toHaveLength(1);
    expect((await f.read())?.document.observations).toEqual([]);
    unmount(app);
    const reopened = await openWorkspace(f);
    await vi.waitFor(() => expect(reopened.container.textContent).toContain("2 agent-reviewed"));
    expect(reopened.container.textContent).toContain("Expert review · 0");
  });

  it("renders undeclared, empty, multiple and legacy community correspondences without treating them as section labels", async () => {
    const f = await workspaceFixture(false, true);
    const { container } = await openWorkspace(f);
    const definition = (name: string) => {
      const element = [...container.querySelectorAll(".review-definition")].find(
        (entry) => entry.querySelector("strong")?.textContent === name,
      );
      if (!element) throw new Error(`Missing definition: ${name}`);
      return element;
    };
    for (const name of ["Synthetic A", "Synthetic B"]) {
      expect(definition(name).querySelectorAll("a")).toHaveLength(0);
      expect(definition(name).textContent).toContain("No community correspondence declared.");
    }
    expect(
      [...definition("Synthetic C").querySelectorAll("a")].map((link) => link.textContent),
    ).toEqual(["synthetic/c", "synthetic/other-community-target"]);
    expect(definition("Synthetic C").textContent).toContain(
      "A separately scoped second correspondence.",
    );
    expect(definition("Synthetic D").querySelector("a")?.textContent).toBe("synthetic/d");
    expect(container.textContent).toContain(
      "Community correspondences do not establish training equivalence.",
    );
    expect(container.querySelectorAll(".review-assessments button")).toHaveLength(9);
    expect((await f.read())?.document.observations).toEqual([]);
  });

  it("saves nine independent synthetic assessments, multiple prominent positives and per-claim noncontiguous evidence through the human UI", async () => {
    const f = await workspaceFixture();
    const { container, app } = await openWorkspace(f);
    await setValue(control(container, "Human reviewer"), "human-ui", "input");
    await setValue(control(container, "Source time"), "1000", "input");
    await click(container, "New section at playhead");
    expect(container.querySelectorAll(".review-assessments button")).toHaveLength(9);

    await setValue(control(container, "Assessment"), "present");
    await setValue(
      control(container, "Evidence / judgment rationale"),
      "Synthetic A reviewed with separate source witnesses.",
      "input",
    );
    for (const index of [0, 2, 4]) await toggleWitness(container, index);
    await setValue(control(container, "Click notes to toggle"), "contextNoteRefs");
    await toggleWitness(container, 1);
    await setValue(control(container, "Click notes to toggle"), "noteRefs");

    await chooseAssessment(container, "synthetic-b");
    await setValue(control(container, "Assessment"), "present");
    await setValue(
      control(container, "Evidence / judgment rationale"),
      "Independent synthetic B judgment.",
      "input",
    );
    await toggleWitness(container, 3);
    await chooseAssessment(container, "synthetic-c");
    await setValue(control(container, "Assessment"), "absent");
    await setValue(
      control(container, "Evidence / judgment rationale"),
      "This dimension was checked and is absent.",
      "input",
    );
    await chooseAssessment(container, "synthetic-d");
    await setValue(control(container, "Assessment"), "unresolved");
    await setValue(
      control(container, "Evidence / judgment rationale"),
      "This checked dimension remains uncertain.",
      "input",
    );

    expect((await f.read())?.document.observations).toEqual([]);
    await click(container, "Save section judgments");
    const saved = await f.read();
    const claims = saved?.document.observations.map((observation) => observation.claim) ?? [];
    expect(claims).toHaveLength(9);
    expect(claims.map((claim) => claim.assessment)).toEqual([
      { presence: "present", salience: "prominent" },
      { presence: "present", salience: "prominent" },
      { presence: "absent" },
      { presence: "unresolved" },
      ...Array.from({ length: 5 }, () => ({ presence: "unreviewed" })),
    ]);
    expect(new Set(claims.map((claim) => claim.sectionId)).size).toBe(1);
    expect(claims[0]?.evidence.noteRefs.map((ref) => ref.startMs)).toEqual([200, 1000, 1500]);
    expect(claims[0]?.evidence.contextNoteRefs.map((ref) => ref.startMs)).toEqual([800]);
    expect(claims[1]?.evidence.noteRefs.map((ref) => ref.startMs)).toEqual([1200]);
    expect(claims[0]?.scope.startMs).toBe(1000);
    expect(claims[0]?.evidence.noteRefs[0]).toMatchObject({
      startMs: 200,
      endMs: 1300,
      kind: "long",
    });

    unmount(app);
    const reopened = await openWorkspace(f);
    expect(reopened.container.textContent).toContain("Human observations · 9");
    expect((await f.read())?.document.observations).toEqual(saved?.document.observations);
  });

  it("imports source-backed proposals without human decisions, then persists an explicit partial acceptance and deferral across duplicate import", async () => {
    const f = await workspaceFixture(true);
    const { container } = await openWorkspace(f);
    await setValue(control(container, "Human reviewer"), "human-ui", "input");
    await upload(container, "Import agent handoff", jsonFile(f.handoff, "handoff.json"));
    expect((await f.read())?.document.decisions).toEqual([]);
    expect(container.querySelector(".claim-fields legend")?.textContent).toBe("Synthetic A");
    expect(
      container.querySelectorAll('.claim-fields button[aria-label^="Remove witness"]'),
    ).toHaveLength(3);
    expect(container.textContent).toContain("200–1300 ms");
    expect(button(container, "Accept original").disabled).toBe(false);
    await click(container, "Accept original");
    expect((await f.read())?.document.observations).toHaveLength(1);
    expect((await f.read())?.document.decisions[0]?.rationale).toBe(
      "Human confirmed the original proposal.",
    );

    await click(container, "Open synthetic-c");
    expect(container.querySelector(".claim-fields legend")?.textContent).toBe("Synthetic C");
    expect(control(container, "Source time").value).toBe("0");
    await setValue(
      control(container, "Human decision rationale"),
      "The question remains open; defer this claim.",
      "input",
    );
    await click(container, "Defer");
    const decided = await f.read();
    expect(decided?.document.decisions.map((decision) => decision.disposition)).toEqual([
      "accepted",
      "deferred",
    ]);
    expect(decided?.document.observations).toHaveLength(1);
    expect(decided?.document.handoffs[0]?.handoff).toEqual(f.handoff);

    await upload(container, "Import agent handoff", jsonFile(f.handoff, "handoff-again.json"));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("duplicate");
    expect((await f.read())?.document).toEqual(decided?.document);
    expect(container.querySelectorAll(".review-handoff")).toHaveLength(1);
  });

  it("restores separate direct and proposal drafts after viewing an observation and rolls back a cancelled range gesture", async () => {
    const f = await workspaceFixture(true);
    const { container } = await openWorkspace(f);
    await setValue(control(container, "Human reviewer"), "human-ui", "input");
    await setValue(
      control(container, "Evidence / judgment rationale"),
      "Unsaved direct draft.",
      "input",
    );
    await upload(container, "Import agent handoff", jsonFile(f.handoff, "handoff.json"));
    await setValue(
      control(container, "Human decision rationale"),
      "Confirmed original A.",
      "input",
    );
    await click(container, "Accept original");
    await chooseProposal(container, "synthetic-b");
    await setValue(
      control(container, "Evidence / judgment rationale"),
      "Unsaved B modification.",
      "input",
    );
    await setValue(
      control(container, "Human decision rationale"),
      "Separate draft decision rationale.",
      "input",
    );
    const numberInputs = container.querySelectorAll<HTMLInputElement>(
      '.claim-fields input[type="number"]',
    );
    await setValue(numberInputs[0], "1100");
    const observationSection = [...container.querySelectorAll(".review-source section")].find(
      (section) => section.querySelector("h2")?.textContent?.startsWith("Human observations"),
    );
    observationSection?.querySelector<HTMLButtonElement>("button")?.click();
    await nextTick();
    expect(control(container, "Assessment").disabled).toBe(true);
    await chooseProposal(container, "synthetic-b");
    expect(control(container, "Evidence / judgment rationale").value).toBe(
      "Unsaved B modification.",
    );
    expect(control(container, "Human decision rationale").value).toBe(
      "Separate draft decision rationale.",
    );
    expect(
      container.querySelector<HTMLInputElement>('.claim-fields input[type="number"]')?.value,
    ).toBe("1100");
    await click(container, "Restore section draft");
    expect(control(container, "Evidence / judgment rationale").value).toBe("Unsaved direct draft.");

    const beforeRange = rangeValues(container);
    const svg = container.querySelector<SVGSVGElement>(".falling-note-viewport");
    if (!svg) throw new Error("Mounted evidence viewport is missing.");
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 640,
        bottom: 900,
        width: 640,
        height: 900,
        toJSON: () => ({}),
      }),
    });
    pointer(svg, "pointerdown", 780);
    pointer(svg, "pointermove", 700);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await nextTick();
    expect(rangeValues(container)).not.toEqual(beforeRange);
    pointer(svg, "pointercancel", 700);
    await nextTick();
    expect(rangeValues(container)).toEqual(beforeRange);
    expect(control(container, "Evidence / judgment rationale").value).toBe("Unsaved direct draft.");
    expect((await f.read())?.document.observations).toHaveLength(1);
  });

  it("keeps a foreign task's claimed Foundation approval out of a newly chosen canonical workspace", async () => {
    const foreign = await workspaceFixture(true);
    const root = new FakeDirectoryHandle("new-workspace");
    picker.mockResolvedValue(root);
    const { container } = mountWorkspace();
    await upload(container, "Open frozen task", jsonFile(foreign.task, "foreign-task.json"));
    await click(container, "Choose workspace folder");
    const fresh = await new WorkflowDirectoryV2(root).read(
      foreign.source.sha256,
      foreign.sourceBytes,
    );
    expect(fresh?.document.foundation.approval).toEqual({ status: "proposed" });
    expect(fresh?.document.decisions).toEqual([]);
    expect(fresh?.document.observations).toEqual([]);
    await upload(
      container,
      "Import agent handoff",
      jsonFile(foreign.handoff, "foreign-handoff.json"),
    );
    await setValue(control(container, "Human reviewer"), "human-ui", "input");
    await setValue(
      control(container, "Human decision rationale"),
      "This imported task has no local human approval.",
      "input",
    );
    expect(button(container, "Accept original").disabled).toBe(true);
    expect(container.querySelector(".review-handoff")?.textContent).toContain("Task base: stale");
  });
});

async function workspaceFixture(withTask = false, mixedCorrespondences = false) {
  const f = await workflowFixture();
  const claim: ClaimV2 = { ...f.claim, id: "claim-a", tagId: "synthetic-a" };
  const foundation: FoundationV2 = {
    ...f.foundation,
    foundationId: "synthetic-ui-test",
    tags: Array.from({ length: 9 }, (_, index) => {
      const letter = String.fromCharCode(97 + index);
      const alignment = {
        catalogueUrl: "https://example.com/synthetic-catalogue",
        externalTagId: `synthetic/${letter}`,
        relation: "related" as const,
        scope: "A test identity, not a real style alignment.",
      };
      return {
        id: `synthetic-${letter}`,
        displayName: `Synthetic ${letter.toUpperCase()}`,
        definition: "Neutral synthetic concept for workflow persistence testing only.",
        inclusionCues: ["Synthetic test evidence."],
        exclusionCues: [],
        ...(mixedCorrespondences && index === 0
          ? {}
          : mixedCorrespondences && index < 3
            ? {
                communityAlignments:
                  index === 1
                    ? []
                    : [
                        alignment,
                        {
                          ...alignment,
                          externalTagId: "synthetic/other-community-target",
                          scope: "A separately scoped second correspondence.",
                        },
                      ],
              }
            : { communityAlignment: alignment }),
      };
    }),
    calibrationExamples: [
      {
        id: "synthetic-example",
        source: f.inspected.source,
        sourceBytes: Array.from(f.sourceBytes),
        claim,
        explanation: "Synthetic fixture approval; no real style semantics are calibrated here.",
      },
    ],
  };
  const root = new FakeDirectoryHandle("test-workspace");
  const directory = new WorkflowDirectoryV2(root);
  const initial = await directory.initialize(f.sourceBytes, foundation);
  const approved = await directory.approveFoundation(
    f.sourceBytes,
    initial.version,
    "fixture-human",
  );
  const exported = withTask
    ? await directory.exportTask(f.sourceBytes, approved.version)
    : undefined;
  const handoff = exported
    ? await sealHandoffV2(exported.task, {
        handoffId: "synthetic-handoff",
        createdAt: NOW,
        agent: { producerId: "synthetic-producer", role: "labeler" },
        proposals: [
          claim,
          { ...claim, id: "claim-b", tagId: "synthetic-b" },
          { ...claim, id: "claim-c", tagId: "synthetic-c", assessment: { presence: "unresolved" } },
        ],
        audit: [
          {
            id: "synthetic-audit",
            claimIds: [claim.id],
            finding: "The referenced hold crosses the declared scope start.",
          },
        ],
        questions: [
          {
            id: "synthetic-question",
            claimIds: ["claim-c"],
            text: "Which synthetic interpretation should remain unresolved?",
          },
        ],
      })
    : undefined;
  return {
    root,
    directory,
    source: f.inspected.source,
    sourceBytes: f.sourceBytes,
    claim,
    task: exported?.task,
    handoff,
    read: () => directory.read(f.inspected.source.sha256, f.sourceBytes),
  };
}

async function openWorkspace(fixture: Awaited<ReturnType<typeof workspaceFixture>>) {
  picker.mockResolvedValue(fixture.root);
  const mounted = mountWorkspace();
  await upload(
    mounted.container,
    "Open .osu difficulties",
    new File([Uint8Array.from(fixture.sourceBytes).buffer], "synthetic.osu"),
  );
  await click(mounted.container, "Choose workspace folder");
  return mounted;
}

function mountWorkspace() {
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp({ render: () => h(ReviewWorkspace) });
  app.config.errorHandler = (error) => appErrors.push(error);
  apps.push(app);
  app.mount(container);
  return { container, app };
}

function unmount(app: ReturnType<typeof createApp>): void {
  app.unmount();
  apps.splice(apps.indexOf(app), 1);
}

function control(
  container: Element,
  text: string,
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const label = [...container.querySelectorAll("label")].find((label) =>
    label.textContent?.trim().startsWith(text),
  );
  const input = label?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input, select, textarea",
  );
  if (!input) throw new Error(`Missing workspace control: ${text}`);
  return input;
}

function button(container: Element, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing workspace button: ${text}`);
  return found;
}

async function click(container: Element, text: string): Promise<void> {
  const target = button(container, text);
  expect(target.disabled, text).toBe(false);
  target.click();
  await idle(container);
}

async function setValue(
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined,
  value: string,
  event = "change",
): Promise<void> {
  if (!input) throw new Error("Missing workspace input.");
  input.value = value;
  input.dispatchEvent(new Event(event, { bubbles: true }));
  await nextTick();
}

async function upload(container: Element, label: string, file: File): Promise<void> {
  const input = control(container, label);
  expect(input).toBeInstanceOf(HTMLInputElement);
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await idle(container);
}

async function idle(container: Element): Promise<void> {
  await nextTick();
  await vi.waitFor(
    () => expect(container.querySelector('[role="status"]')?.textContent).not.toBe("Working…"),
    { interval: 5 },
  );
  await nextTick();
  expect(container.querySelector('[role="alert"]')?.textContent).toBeUndefined();
}

async function toggleWitness(container: Element, index: number): Promise<void> {
  const input = container.querySelectorAll<HTMLInputElement>(
    '.review-note-list input[type="checkbox"]',
  )[index];
  if (!input) throw new Error(`Missing source note ${index}.`);
  input.click();
  await nextTick();
}

async function chooseAssessment(container: Element, tagId: string): Promise<void> {
  const target = [
    ...container.querySelectorAll<HTMLButtonElement>(".review-assessments button"),
  ].find((button) => button.firstElementChild?.textContent === tagId);
  if (!target) throw new Error(`Missing assessment ${tagId}.`);
  target.click();
  await nextTick();
}

async function chooseProposal(container: Element, tagId: string): Promise<void> {
  const target = [
    ...container.querySelectorAll<HTMLButtonElement>(".review-handoff .review-list-row"),
  ].find((button) => button.textContent?.startsWith(tagId));
  if (!target) throw new Error(`Missing proposal ${tagId}.`);
  target.click();
  await nextTick();
}

function rangeValues(container: Element): string[] {
  return [
    ...container.querySelectorAll<HTMLInputElement>('.claim-fields input[type="number"]'),
  ].map((input) => input.value);
}

function pointer(target: Element, type: string, clientY: number): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientY, pointerId: 1 }));
}

function jsonFile(value: unknown, name: string): File {
  return new File([JSON.stringify(value)], name, { type: "application/json" });
}
