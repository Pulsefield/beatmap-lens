import { describe, expect, it } from "vitest";
import { serializeCanonicalJson } from "../canonical-json";
import { FakeDirectoryHandle } from "../test-helpers";
import type { ClaimV2, CommunityAlignmentV2, FoundationV2 } from "./contracts";
import { WorkflowDirectoryV2 } from "./directory";
import {
  addHumanObservationsV2,
  addHumanObservationV2,
  assertFoundationV2,
  assertReviewDocumentV2,
  assertTaskPacketV2,
  baseForTaskV2,
  decideClaimV2,
  handoffBaseStatusV2,
  hashWorkflowValueV2,
  importHandoffV2,
  readDispositionsV2,
  validateHandoffV2,
} from "./domain";
import { createExperimentalFoundationV2 } from "./experimental-campaign";
import { NOW, workflowFixture } from "./test-fixtures";

describe("V2 source-backed agent–human domain", () => {
  it("retains legacy singular correspondence bytes and pinned hashes when reopening existing snapshots", async () => {
    const f = await workflowFixture();
    const root = new FakeDirectoryHandle();
    const workflow = await root.getDirectoryHandle("workflow", { create: true });
    const file = await workflow.getFileHandle(`${f.inspected.source.sha256}.v2.json`, {
      create: true,
    });
    const original = serializeCanonicalJson(f.registered);
    file.setText(original);
    const reopened = await new WorkflowDirectoryV2(root).read(
      f.inspected.source.sha256,
      f.sourceBytes,
    );

    expect(serializeCanonicalJson(reopened?.document)).toBe(original);
    expect(await (await file.getFile()).text()).toBe(original);
    expect(await hashWorkflowValueV2(reopened?.document.foundation)).toBe(
      "086b4d74eb8d49b19a6b311cd21550e08c150cd1c2cc2173c05afcc70c9973d0",
    );
    expect(reopened?.document.tasks[0]?.taskSha256).toBe(
      "ef6575aa3630fb5e780c794ae110c611ac3c7b7a77673a71cb505e90df827fb6",
    );
    expect(
      reopened?.document.foundation.tags.every(
        (tag) => "communityAlignment" in tag && !("communityAlignments" in tag),
      ),
    ).toBe(true);
  });

  it("accepts missing, empty and multiple correspondences without turning them into section judgments", async () => {
    const f = await workflowFixture();
    const pilot = createExperimentalFoundationV2(NOW);
    const links: readonly CommunityAlignmentV2[] = [
      {
        catalogueUrl: "https://example.com/catalogue",
        externalTagId: "synthetic/community-a",
        relation: "related",
        scope: "One candidate relationship; no automatic training equivalence.",
      },
      {
        catalogueUrl: "https://example.com/catalogue",
        externalTagId: "synthetic/community-b",
        relation: "broader",
        scope: "A second scoped relationship requiring a separate consumer decision.",
      },
    ];
    const foundation: FoundationV2 = {
      ...pilot,
      tags: pilot.tags.map(({ communityAlignment: _, communityAlignments: __, ...tag }, index) =>
        index === 0 ? tag : { ...tag, communityAlignments: index === 1 ? [] : links },
      ),
    };
    await expect(assertFoundationV2(foundation)).resolves.toEqual(foundation);
    const root = new FakeDirectoryHandle();
    const directory = new WorkflowDirectoryV2(root);
    const initial = await directory.initialize(f.sourceBytes, foundation);
    const exported = await directory.exportTask(f.sourceBytes, initial.version);
    const reopened = await new WorkflowDirectoryV2(root).read(
      f.inspected.source.sha256,
      f.sourceBytes,
    );
    expect(reopened?.document.foundation).toEqual(foundation);
    expect((await assertTaskPacketV2(exported.task)).foundation).toEqual(foundation);
    expect(reopened?.document.observations).toEqual([]);
    expect(reopened?.document.foundation.tags.map((tag) => tag.id)).toEqual(
      pilot.tags.map((tag) => tag.id),
    );
  });

  it("rejects ambiguous singular and plural correspondence declarations", async () => {
    const f = await workflowFixture();
    await expect(
      assertFoundationV2({
        ...f.foundation,
        tags: f.foundation.tags.map((tag) => ({ ...tag, communityAlignments: [] })),
      }),
    ).rejects.toThrow("both");
  });

  it("round-trips mixed independent assessments with per-claim witnesses, entry occupancy, boundaries and transitions", async () => {
    const f = await workflowFixture();
    const claims: ClaimV2[] = [
      f.claim,
      { ...f.claim, id: "streams", tagId: "streams" },
      {
        ...f.claim,
        id: "absent",
        tagId: "jumpstream",
        assessment: { presence: "absent" },
        evidence: {
          noteRefs: [],
          contextNoteRefs: [],
          rationale: "I inspected the arrangement and found no jumpstream.",
        },
      },
      { ...f.claim, id: "uncertain", tagId: "speedjack", assessment: { presence: "unresolved" } },
      {
        id: "unreviewed",
        sectionId: "mixed-section",
        tagId: "longjack",
        scope: f.claim.scope,
        reviewContext: f.claim.reviewContext,
        assessment: { presence: "unreviewed" },
        evidence: { noteRefs: [], contextNoteRefs: [], rationale: "" },
      },
    ];
    const document = await addHumanObservationsV2(
      f.document,
      { claims, humanId: "expert" },
      f.sourceBytes,
    );
    const restored = await assertReviewDocumentV2(
      JSON.parse(serializeCanonicalJson(document)),
      f.sourceBytes,
    );
    expect(restored.observations.map((entry) => entry.claim)).toEqual(claims);
    expect(
      restored.observations.filter((entry) => entry.claim.assessment.presence === "present"),
    ).toHaveLength(2);
    expect(restored.observations[0]?.claim.evidence.noteRefs[0]?.startMs).toBeLessThan(
      f.claim.scope.startMs,
    );
  });

  it("freezes complete exact source facts and keeps task registration outside the human task base", async () => {
    const f = await workflowFixture();
    expect(await baseForTaskV2(f.registered)).toEqual(f.task.base);
    expect(f.task.structure.notes).toHaveLength(6);
    expect(f.task.structure.timingPoints[0]?.fields[1]).toBe("500");
    expect(await assertTaskPacketV2(JSON.parse(JSON.stringify(f.task)))).toEqual(f.task);
    await expect(
      assertTaskPacketV2({
        ...f.task,
        structure: { ...f.task.structure, notes: f.task.structure.notes.slice(1) },
      }),
    ).rejects.toThrow("structure");
  });

  it("accepts independent siblings, defers one and preserves originals across duplicate exchanges", async () => {
    const f = await workflowFixture();
    let result = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    expect(result.baseStatus).toBe("current");
    let document = await decideClaimV2(
      result.document,
      {
        handoffId: f.handoff.handoffId,
        claimId: f.claim.id,
        disposition: "accepted",
        humanId: "expert",
        rationale: "Confirmed.",
      },
      f.sourceBytes,
    );
    document = await decideClaimV2(
      document,
      {
        handoffId: f.handoff.handoffId,
        claimId: "streams-claim",
        disposition: "modified",
        modifiedClaim: {
          ...f.claim,
          id: "streams-claim",
          tagId: "streams",
          assessment: { presence: "present", salience: "supporting" },
        },
        humanId: "expert",
        rationale: "Present with supporting salience.",
      },
      f.sourceBytes,
    );
    document = await decideClaimV2(
      document,
      {
        handoffId: f.handoff.handoffId,
        claimId: "speedjack-claim",
        disposition: "deferred",
        humanId: "expert",
        rationale: "Needs calibration.",
      },
      f.sourceBytes,
    );
    result = await importHandoffV2(document, f.handoff, f.sourceBytes);
    expect(result.status).toBe("duplicate");
    expect(result.document).toBe(document);
    expect(document.handoffs[0]?.handoff).toEqual(f.handoff);
    expect(document.observations).toHaveLength(2);
    expect(document.decisions.map((decision) => decision.disposition)).toEqual([
      "accepted",
      "modified",
      "deferred",
    ]);
    expect(
      (await readDispositionsV2(document)).handoffs[0]?.claims[2]?.decisions[0]?.disposition,
    ).toBe("deferred");
    await expect(assertReviewDocumentV2(document, f.sourceBytes)).resolves.toEqual(document);
  });

  it("makes late and subsequently stale proposals visible without allowing them to overwrite human work", async () => {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const human = await addHumanObservationV2(
      imported.document,
      { claim: f.claim, humanId: "expert" },
      f.sourceBytes,
    );
    expect(await handoffBaseStatusV2(human, f.handoff.handoffId)).toBe("stale");
    expect((await readDispositionsV2(human)).handoffs[0]?.baseStatus).toBe("stale");
    await expect(
      decideClaimV2(
        human,
        {
          handoffId: f.handoff.handoffId,
          claimId: f.claim.id,
          disposition: "accepted",
          humanId: "expert",
          rationale: "",
        },
        f.sourceBytes,
      ),
    ).rejects.toThrow("Stale task base");
    const lateResult = await importHandoffV2(
      human,
      { ...f.handoff, handoffId: "late" },
      f.sourceBytes,
    );
    expect(lateResult.baseStatus).toBe("stale");
    expect(lateResult.document.observations).toEqual(human.observations);
  });

  it("keeps rejection separate from negative and lets a human resolve a deferred claim", async () => {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const rejected = await decideClaimV2(
      imported.document,
      {
        handoffId: f.handoff.handoffId,
        claimId: f.claim.id,
        disposition: "rejected",
        humanId: "expert",
        rationale: "The proposed concept is not supported by this evidence.",
      },
      f.sourceBytes,
    );
    expect(rejected.observations).toEqual([]);
    const deferred = await decideClaimV2(
      rejected,
      {
        handoffId: f.handoff.handoffId,
        claimId: "streams-claim",
        disposition: "deferred",
        humanId: "expert",
        rationale: "Return after checking the previous phrase.",
      },
      f.sourceBytes,
    );
    const resolved = await decideClaimV2(
      deferred,
      {
        handoffId: f.handoff.handoffId,
        claimId: "streams-claim",
        disposition: "accepted",
        humanId: "expert",
        rationale: "Context checked.",
      },
      f.sourceBytes,
    );
    expect(resolved.decisions).toHaveLength(3);
    expect(resolved.observations).toHaveLength(1);
    await expect(
      decideClaimV2(
        resolved,
        {
          handoffId: f.handoff.handoffId,
          claimId: f.claim.id,
          disposition: "accepted",
          humanId: "expert",
          rationale: "",
        },
        f.sourceBytes,
      ),
    ).rejects.toThrow("already has a final human decision");
  });

  it("rejects human authority fields, forged evidence and mismatched source at the actual handoff boundary", async () => {
    const f = await workflowFixture();
    await expect(validateHandoffV2({ ...f.handoff, decisions: [] }, f.task)).rejects.toThrow(
      "not an allowed field",
    );
    await expect(
      validateHandoffV2({ ...f.handoff, proposals: [{ ...f.claim, humanId: "forged" }] }, f.task),
    ).rejects.toThrow("not an allowed field");
    await expect(
      importHandoffV2(f.registered, { ...f.handoff, sourceSha256: "f".repeat(64) }, f.sourceBytes),
    ).rejects.toThrow("Source mismatch");
    await expect(
      validateHandoffV2(
        {
          ...f.handoff,
          proposals: [
            {
              ...f.claim,
              evidence: { ...f.claim.evidence, noteRefs: [{ ...f.refs[0], startMs: 0 }] },
            },
          ],
        },
        f.task,
      ),
    ).rejects.toThrow("does not resolve");
    await expect(
      addHumanObservationV2(f.proposed, { claim: f.claim, humanId: "expert" }, f.sourceBytes),
    ).rejects.toThrow("approve the Foundation");
  });
});
