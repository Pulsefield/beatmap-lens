import { describe, expect, it, vi } from "vitest";
import { serializeCanonicalJson, sha256Hex } from "../canonical-json";
import { inspectOsuSourceV1 } from "../source-identity";
import { FakeDirectoryHandle, FakeFileHandle } from "../test-helpers";
import { WorkflowConflictError, WorkflowDirectoryV2 } from "./directory";
import { hashWorkflowValueV2, sealHandoffV2 } from "./domain";
import { workflowFixture } from "./test-fixtures";

describe("V2 canonical workflow commands", () => {
  it("derives the version from exact canonical bytes while retaining semantic validation", async () => {
    const f = await workflowFixture();
    const root = new FakeDirectoryHandle();
    const files = await root.getDirectoryHandle("workflow", { create: true });
    const file = await files.getFileHandle(`${f.inspected.source.sha256}.v2.json`, {
      create: true,
    });
    const text = serializeCanonicalJson(f.registered);
    file.setText(text);
    const directory = new WorkflowDirectoryV2(root);
    expect(await directory.read(f.inspected.source.sha256)).toEqual({
      document: f.registered,
      version: { revision: f.registered.revision, sha256: await sha256Hex(text) },
    });
    file.setText(JSON.stringify(f.registered));
    await expect(directory.read(f.inspected.source.sha256)).rejects.toThrow("not canonical JSON");
    file.setText(
      serializeCanonicalJson({
        ...f.registered,
        tasks: [{ ...f.task, taskSha256: "0".repeat(64) }],
      }),
    );
    await expect(directory.read(f.inspected.source.sha256)).rejects.toThrow("task.taskSha256");
  });

  it("registers a new source with the same trusted approval and an empty history in one write", async () => {
    const f = await workflowFixture();
    const directory = new WorkflowDirectoryV2(new FakeDirectoryHandle());
    const initial = await directory.initialize(f.sourceBytes, f.foundation);
    const approved = await directory.approveFoundation(f.sourceBytes, initial.version, "expert", {
      now: () => "2026-09-05T01:00:00.000Z",
    });
    const exported = await directory.exportTask(f.sourceBytes, approved.version);
    const original = await directory.addObservations(f.sourceBytes, exported.stored.version, {
      claims: [f.claim],
      humanId: "expert",
    });
    const reference = {
      sourceSha256: f.inspected.source.sha256,
      foundationSha256: await hashWorkflowValueV2(original.document.foundation),
    };
    const newBytes = new TextEncoder().encode(
      new TextDecoder().decode(f.sourceBytes).replace("Version: Mixed", "Version: Another"),
    );
    const writes = vi.spyOn(FakeFileHandle.prototype, "createWritable");
    const registered = await directory.registerSourceFromApprovedFoundation(newBytes, reference);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(registered.task.source.sha256).not.toBe(reference.sourceSha256);
    expect(registered.task.sourceBytes).toEqual(Array.from(newBytes));
    expect(registered.task.foundationSha256).toBe(reference.foundationSha256);
    expect(registered.task.foundation).toEqual(original.document.foundation);
    expect(registered.stored.document).toMatchObject({
      reviewRevision: 1,
      foundation: original.document.foundation,
      decisions: [],
      observations: [],
      handoffs: [],
      tasks: [registered.task],
    });
    const repeat = await directory.registerSourceFromApprovedFoundation(newBytes, reference, {
      taskId: "must-not-rebase-an-existing-source",
    });
    expect(repeat).toEqual(registered);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(await directory.read(reference.sourceSha256, f.sourceBytes)).toEqual(original);
    expect(await directory.read(registered.task.source.sha256, newBytes)).toEqual(
      registered.stored,
    );
  });

  it("blocks unapproved or changed Foundation references and never switches an existing source", async () => {
    const f = await workflowFixture();
    const directory = new WorkflowDirectoryV2(new FakeDirectoryHandle());
    const initial = await directory.initialize(f.sourceBytes, f.foundation);
    const newBytes = new TextEncoder().encode(
      new TextDecoder().decode(f.sourceBytes).replace("Version: Mixed", "Version: Another"),
    );
    const newSource = (await inspectOsuSourceV1(newBytes)).source;
    const reference = {
      sourceSha256: f.inspected.source.sha256,
      foundationSha256: await hashWorkflowValueV2(initial.document.foundation),
    };
    await expect(
      directory.registerSourceFromApprovedFoundation(newBytes, reference),
    ).rejects.toThrow("needs human approval");
    expect(await directory.read(newSource.sha256, newBytes)).toBeNull();
    const approved = await directory.approveFoundation(f.sourceBytes, initial.version, "expert");
    await expect(
      directory.registerSourceFromApprovedFoundation(newBytes, reference),
    ).rejects.toThrow("Foundation hash differs");
    expect(await directory.read(newSource.sha256, newBytes)).toBeNull();
    const existing = await directory.initialize(newBytes, f.foundation);
    await expect(
      directory.registerSourceFromApprovedFoundation(newBytes, {
        ...reference,
        foundationSha256: await hashWorkflowValueV2(approved.document.foundation),
      }),
    ).rejects.toThrow("existing source has a different Foundation");
    expect(await directory.read(newSource.sha256, newBytes)).toEqual(existing);
  });

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
