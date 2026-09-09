// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, shallowRef } from "vue";
import type { AssessmentV2, ClaimV2 } from "./annotation/workflow/contracts";
import { workflowFixture } from "./annotation/workflow/test-fixtures";
import WorkflowSectionSliders from "./WorkflowSectionSliders.vue";

const apps: ReturnType<typeof createApp>[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.replaceChildren();
});

describe("WorkflowSectionSliders", () => {
  it("keeps all five assessments visible and leaves unknown assessments distinct from absent", async () => {
    const { container, claims, updates } = await mountSliders();
    const sliders = [...container.querySelectorAll<HTMLInputElement>('input[type="range"]')];
    expect(sliders).toHaveLength(5);
    expect(sliders.map((slider) => slider.getAttribute("aria-valuetext"))).toEqual([
      "Unreviewed",
      "Unresolved",
      "Absent",
      "Supporting",
      "Prominent",
    ]);
    expect(
      sliders.map((slider) => slider.closest(".slider-row")?.classList.contains("unrated")),
    ).toEqual([true, true, false, false, false]);
    expect(
      sliders.every((slider) => slider.min === "0" && slider.max === "2" && slider.step === "1"),
    ).toBe(true);
    expect(claims.value.map((claim) => claim.assessment.presence)).toEqual([
      "unreviewed",
      "unresolved",
      "absent",
      "present",
      "present",
    ]);
    expect(updates).toEqual([]);
  });

  it("makes a deliberate click on the left endpoint absent, without changing another tag or source evidence", async () => {
    const { container, claims, originals, updates, selected } = await mountSliders();
    slider(container, 0).click();
    await nextTick();
    expect(claims.value[0]).toEqual({ ...originals[0], assessment: { presence: "absent" } });
    expect(claims.value.slice(1)).toEqual(originals.slice(1));
    expect(originals[0]?.assessment).toEqual({ presence: "unreviewed" });
    expect(updates).toHaveLength(1);
    expect(selected).toContain(originals[0]?.id);
    expect(slider(container, 0).getAttribute("aria-valuetext")).toBe("Absent");
  });

  it("supports discrete arrow and endpoint keys, including absent at an initially unknown endpoint", async () => {
    const { container, claims, updates } = await mountSliders();
    const control = slider(container, 0);
    await press(control, "ArrowLeft");
    expect(claims.value[0]?.assessment).toEqual({ presence: "absent" });
    await press(control, "ArrowRight");
    expect(claims.value[0]?.assessment).toEqual({ presence: "present", salience: "supporting" });
    await press(control, "End");
    expect(claims.value[0]?.assessment).toEqual({ presence: "present", salience: "prominent" });
    await press(control, "ArrowUp");
    expect(updates).toHaveLength(3);
    await press(control, "Home");
    expect(claims.value[0]?.assessment).toEqual({ presence: "absent" });
    expect(control.getAttribute("aria-valuetext")).toBe("Absent");
  });

  it("emits only one update for native input, change and click, and can explicitly mark a row unresolved", async () => {
    const { container, claims, originals, updates } = await mountSliders();
    const control = slider(container, 0);
    control.value = "1";
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.click();
    await nextTick();
    expect(updates).toHaveLength(1);
    expect(claims.value[0]?.assessment).toEqual({ presence: "present", salience: "supporting" });
    const unresolved = container.querySelector<HTMLButtonElement>(
      '[aria-label="Mark Style 1 unresolved"]',
    );
    unresolved?.click();
    await nextTick();
    expect(updates).toHaveLength(2);
    expect(claims.value[0]).toEqual({ ...originals[0], assessment: { presence: "unresolved" } });
    expect(control.closest(".slider-row")?.classList.contains("unrated")).toBe(true);
  });

  it("selects a row for evidence independently and emits nothing while disabled", async () => {
    const { container, selected, updates, originals, disabled } = await mountSliders();
    const label = container.querySelector<HTMLButtonElement>('[aria-label="Style 2 evidence"]');
    label?.click();
    expect(selected).toEqual([originals[1]?.id]);
    expect(updates).toEqual([]);
    disabled.value = true;
    await nextTick();
    for (const button of container.querySelectorAll<HTMLButtonElement>("button")) {
      expect(button.disabled).toBe(true);
      button.click();
    }
    const control = slider(container, 0);
    expect(control.disabled).toBe(true);
    control.value = "2";
    control.dispatchEvent(new Event("input", { bubbles: true }));
    await press(control, "Home");
    expect(selected).toEqual([originals[1]?.id]);
    expect(updates).toEqual([]);
  });
});

async function mountSliders() {
  const fixture = await workflowFixture();
  const assessments: readonly AssessmentV2[] = [
    { presence: "unreviewed" },
    { presence: "unresolved" },
    { presence: "absent" },
    { presence: "present", salience: "supporting" },
    { presence: "present", salience: "prominent" },
  ];
  const tags = fixture.foundation.tags.map((tag, index) => ({
    ...tag,
    displayName: `Style ${index + 1}`,
  }));
  const originals: readonly ClaimV2[] = tags.map((tag, index) => ({
    ...fixture.claim,
    id: `claim-${index}`,
    tagId: tag.id,
    playbackRate: 0.75,
    assessment: assessments[index] as AssessmentV2,
  }));
  const claims = shallowRef(originals);
  const disabled = shallowRef(false);
  const updates: ClaimV2[] = [];
  const selected: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(WorkflowSectionSliders, {
        claims: claims.value,
        tags,
        disabled: disabled.value,
        activeClaimId: "claim-0",
        "onUpdate:claim": (claim) => {
          updates.push(claim);
          claims.value = claims.value.map((previous) =>
            previous.id === claim.id ? claim : previous,
          );
        },
        onSelect: (claimId) => selected.push(claimId),
      }),
  });
  apps.push(app);
  app.mount(container);
  await nextTick();
  return { container, claims, originals, updates, selected, disabled };
}

function slider(container: Element, index: number): HTMLInputElement {
  const control = container.querySelectorAll<HTMLInputElement>('input[type="range"]')[index];
  if (!control) throw new Error(`Missing slider ${index}.`);
  return control;
}

async function press(control: HTMLInputElement, key: string): Promise<void> {
  control.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  await nextTick();
}
