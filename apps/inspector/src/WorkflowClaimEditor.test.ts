// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, shallowRef } from "vue";
import type { TimeRangeV1 } from "./annotation/contracts";
import type { ClaimV2 } from "./annotation/workflow/contracts";
import { workflowFixture } from "./annotation/workflow/test-fixtures";
import WorkflowClaimEditor from "./WorkflowClaimEditor.vue";

const apps: ReturnType<typeof createApp>[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.replaceChildren();
});

describe("WorkflowClaimEditor", () => {
  it("edits source scope, context and discontiguous witnesses without changing source facts or conflating assessment and salience", async () => {
    const { container, claim, original } = await mountEditor();
    const ranges = container.querySelectorAll<HTMLInputElement>('input[type="number"]');
    await change(ranges[0], "900");
    await change(ranges[1], "1750");
    await change(ranges[2], "100");
    await change(ranges[3], "1850");
    const removed = original.evidence.noteRefs[1];
    if (!removed) throw new Error("Fixture witness is missing.");
    const remove = container.querySelector<HTMLButtonElement>(
      `[aria-label="Remove witness source line ${removed.sourceLine}"]`,
    );
    remove?.click();
    await nextTick();

    expect(claim.value.scope).toEqual({ startMs: 900, endMs: 1750 });
    expect(claim.value.reviewContext).toEqual({ startMs: 100, endMs: 1850 });
    expect(claim.value.evidence.noteRefs).toEqual(
      original.evidence.noteRefs.filter((ref) => ref !== removed),
    );
    expect(claim.value.evidence.contextNoteRefs).toEqual(original.evidence.contextNoteRefs);
    expect(claim.value.evidence.noteRefs[0]).toMatchObject({
      kind: "long",
      startMs: 200,
      endMs: 1300,
    });

    await change(control(container, "Salience"), "supporting");
    expect(claim.value.assessment).toEqual({ presence: "present", salience: "supporting" });
    await change(control(container, "Assessment"), "unresolved");
    expect(claim.value.assessment).toEqual({ presence: "unresolved" });
    expect(control(container, "Exemplar role").value).toBe("typical-positive");
    expect(original.assessment).toEqual({ presence: "present", salience: "prominent" });
    expect(original.scope).toEqual({ startMs: 1000, endMs: 1800 });
    expect(claim.value.transition).toEqual(original.transition);
  });

  it("clears optional boundaries and independently edits, locates and removes a transition with its own evidence", async () => {
    const { container, claim, focused, original } = await mountEditor();
    await change(control(container, "Acceptable start cuts"), "");
    expect(claim.value.boundaryUncertainty).toEqual({ end: original.boundaryUncertainty?.end });
    await change(control(container, "Acceptable end cuts"), "");
    expect("boundaryUncertainty" in claim.value).toBe(false);

    await change(control(container, "Transition start"), "1000");
    await change(control(container, "Transition end"), "1550");
    await change(
      control(container, "Transition description"),
      "Synthetic change relation for editor verification.",
      "input",
    );
    await change(
      control(container, "Transition evidence rationale"),
      "Independent transition evidence.",
      "input",
    );
    expect(claim.value.transition).toEqual({
      ...original.transition,
      range: { startMs: 1000, endMs: 1550 },
      description: "Synthetic change relation for editor verification.",
      evidence: { ...original.transition?.evidence, rationale: "Independent transition evidence." },
    });
    await click(container, "Copy current claim witnesses and context to transition");
    expect(claim.value.transition?.evidence).toEqual({
      ...original.evidence,
      rationale: "Independent transition evidence.",
    });
    await click(container, "View transition evidence");
    expect(focused).toEqual([{ startMs: 1000, endMs: 1550 }]);
    expect(claim.value.evidence).toEqual(original.evidence);
    await click(container, "Remove transition");
    expect("transition" in claim.value).toBe(false);
    expect(container.textContent).toContain("No transition asserted");
    await click(container, "Add transition");
    expect(claim.value.transition).toEqual({
      range: original.scope,
      description: "",
      evidence: { noteRefs: [], contextNoteRefs: [], rationale: "" },
    });
    expect(claim.value.evidence).toEqual(original.evidence);
  });

  it("keeps source and transition views usable while human observations are read-only", async () => {
    const { container, focused, original } = await mountEditor({ disabled: true });
    for (const view of container.querySelectorAll<HTMLButtonElement>(".claim-field-heading button"))
      view.click();
    const transitionView = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "View transition evidence",
    );
    expect(transitionView?.closest("fieldset[disabled]")).toBeNull();
    transitionView?.click();
    expect(focused).toEqual([original.scope, original.reviewContext, original.transition?.range]);
    expect(control(container, "Assessment").disabled).toBe(true);
    expect(control(container, "Transition description").disabled).toBe(true);
  });
});

async function mountEditor(options: { readonly disabled?: boolean } = {}) {
  const fixture = await workflowFixture();
  const original: ClaimV2 = { ...fixture.claim, tagId: "synthetic-a" };
  const tag = fixture.foundation.tags[0];
  if (!tag) throw new Error("Fixture tag is missing.");
  const tags = [
    {
      ...tag,
      id: "synthetic-a",
      displayName: "Synthetic A",
      definition: "A neutral concept used only to test the editor contract.",
    },
  ];
  const claim = shallowRef(original);
  const focused: TimeRangeV1[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(WorkflowClaimEditor, {
        modelValue: claim.value,
        tags,
        disabled: options.disabled ?? false,
        "onUpdate:modelValue": (value) => {
          claim.value = value;
        },
        onFocus: (range) => focused.push(range),
      }),
  });
  apps.push(app);
  app.mount(container);
  await nextTick();
  return { container, claim, focused, original };
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
  if (!input) throw new Error(`Missing editor control: ${text}`);
  return input;
}

async function change(
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined,
  value: string,
  event = "change",
): Promise<void> {
  if (!input) throw new Error("Missing editor input.");
  input.value = value;
  input.dispatchEvent(new Event(event, { bubbles: true }));
  await nextTick();
}

async function click(container: Element, text: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Missing editor action: ${text}`);
  button.click();
  await nextTick();
}
