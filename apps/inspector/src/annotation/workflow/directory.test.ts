import { describe, expect, it } from "vitest";
import { FakeDirectoryHandle } from "../test-helpers";
import { WorkflowConflictError, WorkflowDirectoryV2 } from "./directory";
import { sealHandoffV2 } from "./domain";
import { workflowFixture } from "./test-fixtures";

describe("V2 canonical workflow commands", () => {
  it("round-trips independent human observations without touching V1 files", async () => {
    const f = await workflowFixture();
    const root = new FakeDirectoryHandle();
    const legacy = await root.getFileHandle("dataset.json", { create: true });
    legacy.setText("V1 manifest remains unchanged");
    const directory = new WorkflowDirectoryV2(root);
    const initial = await directory.initialize(f.sourceBytes, f.foundation);
    const approved = await directory.approveFoundation(f.sourceBytes, initial.version, "expert");
    const saved = await directory.addObservations(f.sourceBytes, approved.version, {
      claims: [f.claim, { ...f.claim, id: "streams", tagId: "streams" }],
      humanId: "expert",
    });
    expect(
      await new WorkflowDirectoryV2(root).read(f.inspected.source.sha256, f.sourceBytes),
    ).toEqual(saved);
    expect(await (await legacy.getFile()).text()).toBe("V1 manifest remains unchanged");
    expect([...root.children.keys()]).toEqual(["dataset.json", "workflow"]);
  });

  it("imports once and preserves decisions against repeated or conflicting agent exchange", async () => {
    const f = await workflowFixture();
    const directory = new WorkflowDirectoryV2(new FakeDirectoryHandle());
    const initial = await directory.initialize(f.sourceBytes, f.foundation);
    const approved = await directory.approveFoundation(f.sourceBytes, initial.version, "expert");
    const exported = await directory.exportTask(f.sourceBytes, approved.version);
    const handoff = await sealHandoffV2(exported.task, {
      handoffId: "exchange",
      createdAt: f.handoff.createdAt,
      agent: f.handoff.agent,
      proposals: f.handoff.proposals,
      audit: f.handoff.audit,
      questions: f.handoff.questions,
    });
    const imported = await directory.importHandoff(f.sourceBytes, exported.stored.version, handoff);
    expect(imported.baseStatus).toBe("current");
    const decided = await directory.decide(f.sourceBytes, imported.stored.version, {
      handoffId: handoff.handoffId,
      claimId: f.claim.id,
      disposition: "accepted",
      humanId: "expert",
      rationale: "Confirmed evidence.",
    });
    const duplicate = await directory.importHandoff(f.sourceBytes, decided.version, handoff);
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.stored).toEqual(decided);
    await expect(
      directory.importHandoff(f.sourceBytes, decided.version, { ...handoff, createdAt: "changed" }),
    ).rejects.toThrow("different immutable content");
    await expect(
      directory.decide(f.sourceBytes, imported.stored.version, {
        handoffId: handoff.handoffId,
        claimId: "streams-claim",
        disposition: "rejected",
        humanId: "expert",
        rationale: "",
      }),
    ).rejects.toBeInstanceOf(WorkflowConflictError);
    expect(
      (await directory.read(f.inspected.source.sha256, f.sourceBytes))?.document.observations,
    ).toEqual(decided.document.observations);
  });

  it("protects Foundation approval and revalidates exact source evidence on every human save", async () => {
    const f = await workflowFixture();
    const directory = new WorkflowDirectoryV2(new FakeDirectoryHandle());
    await expect(directory.initialize(f.sourceBytes, f.document.foundation)).rejects.toThrow(
      "cannot grant human approval",
    );
    const initial = await directory.initialize(f.sourceBytes, f.foundation);
    const approved = await directory.approveFoundation(f.sourceBytes, initial.version, "expert");
    await expect(
      directory.addObservations(f.sourceBytes, approved.version, {
        claims: [
          {
            ...f.claim,
            evidence: {
              ...f.claim.evidence,
              noteRefs: [
                {
                  ...(f.claim.evidence.noteRefs[0] as import("../contracts").StableNoteRefV1),
                  endMs: 99999,
                },
              ],
            },
          },
        ],
        humanId: "expert",
      }),
    ).rejects.toThrow("does not resolve");
    expect(
      (await directory.read(f.inspected.source.sha256, f.sourceBytes))?.document.observations,
    ).toEqual([]);
  });
});
