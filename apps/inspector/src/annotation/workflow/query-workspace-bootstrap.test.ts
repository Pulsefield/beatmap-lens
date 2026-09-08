import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { serializeCanonicalJson } from "../canonical-json";
import { WorkflowDirectoryV2 } from "./directory";
import {
  addHumanObservationV2,
  decideClaimV2,
  hashWorkflowValueV2,
  importHandoffV2,
} from "./domain";
import { NOW, workflowFixture } from "./test-fixtures";

const bootstrapUrl = pathToFileURL(
  resolve("annotation/pipeline/prepare-query-campaign-workspace.mjs"),
).href;
const adapterUrl = pathToFileURL(
  resolve("apps/inspector/server/workflow-local-directory.mjs"),
).href;
const { prepareQueryCampaign, approvePreparedQueryCampaign } = await import(
  /* @vite-ignore */ bootstrapUrl
);
const { LocalDirectoryHandle } = await import(/* @vite-ignore */ adapterUrl);

it("prepares exact prior human calibration and explicitly approves an isolated empty history without changing the archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "query-bootstrap-"));
  try {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const modifiedClaim = {
      ...f.claim,
      assessment: { presence: "present" as const, salience: "supporting" as const },
    };
    const modified = await decideClaimV2(
      imported.document,
      {
        handoffId: f.handoff.handoffId,
        claimId: f.claim.id,
        disposition: "modified",
        modifiedClaim,
        humanId: "original-expert",
        rationale: "Human chose supporting after reviewing the source.",
      },
      f.sourceBytes,
    );
    const historical = await addHumanObservationV2(
      modified,
      {
        claim: { ...modifiedClaim, id: "direct-clarification" },
        humanId: "original-expert",
        now: () => NOW,
      },
      f.sourceBytes,
    );
    const oldWorkspace = join(root, "old");
    const workspace = join(root, "new");
    await mkdir(join(oldWorkspace, "workflow"), { recursive: true });
    const oldFile = join(oldWorkspace, "workflow", `${f.inspected.source.sha256}.v2.json`);
    const oldBytes = serializeCanonicalJson(historical);
    await writeFile(oldFile, oldBytes);
    const prepared = await prepareQueryCampaign({
      oldWorkspace,
      workspace,
      createdAt: NOW,
      selections: historical.observations.map((observation) => ({
        sourceSha256: f.inspected.source.sha256,
        observationId: observation.id,
        tagId: observation.claim.tagId,
        assessment: observation.claim.assessment,
      })),
    });
    await expect(readdir(workspace)).rejects.toMatchObject({ code: "ENOENT" });
    expect(prepared.foundation.approval).toEqual({ status: "proposed" });
    expect(prepared.foundation.tags).toHaveLength(5);
    expect(prepared.provenance.map((entry: { observation: unknown }) => entry.observation)).toEqual(
      historical.observations,
    );
    expect(prepared.provenance[0].decision).toEqual(historical.decisions[0]);
    expect(
      prepared.foundation.calibrationExamples.map((entry: { claim: unknown }) => entry.claim),
    ).toEqual(historical.observations.map((entry) => entry.claim));
    const artifact = join(root, "prepared.json");
    const content = JSON.stringify(prepared, null, 2);
    await writeFile(artifact, content);
    const approval = {
      prepared: artifact,
      preparedSha256: createHash("sha256").update(content).digest("hex"),
      humanId: "query-expert",
      authorization: "Explicit fixture approval of these prepared definitions and examples.",
    };
    await expect(
      approvePreparedQueryCampaign({ ...approval, preparedSha256: "0".repeat(64) }),
    ).rejects.toThrow("reviewed SHA-256");
    await expect(readdir(workspace)).rejects.toMatchObject({ code: "ENOENT" });
    const receipt = await approvePreparedQueryCampaign(approval);
    const stored = await new WorkflowDirectoryV2(new LocalDirectoryHandle(workspace)).read(
      f.inspected.source.sha256,
    );
    expect(stored?.document.foundation.approval).toMatchObject({
      status: "human-approved",
      humanId: "query-expert",
    });
    expect(stored?.document.foundation.calibrationExamples).toEqual(
      prepared.foundation.calibrationExamples,
    );
    expect(stored?.document.observations).toEqual([]);
    expect(stored?.document.decisions).toEqual([]);
    expect(stored?.document.handoffs).toEqual([]);
    expect(stored?.document.tasks).toHaveLength(1);
    expect(receipt.foundationSha256).toBe(await hashWorkflowValueV2(stored?.document.foundation));
    const again = await approvePreparedQueryCampaign(approval);
    expect(again.taskSha256).toBe(receipt.taskSha256);
    expect(again.documentVersion).toEqual(receipt.documentVersion);
    expect(await readFile(oldFile, "utf8")).toBe(oldBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
