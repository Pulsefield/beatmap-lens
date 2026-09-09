import { describe, expect, it } from "vitest";
import { serializeCanonicalJson } from "../canonical-json";
import { resolvePlaybackRate, SUPPORTED_PLAYBACK_RATES } from "../playback-rate";
import { FakeDirectoryHandle } from "../test-helpers";
import type { ClaimV2, ReviewDocumentV2 } from "./contracts";
import { WorkflowDirectoryV2 } from "./directory";
import {
  addHumanObservationV2,
  assertClaimV2,
  assertReviewDocumentV2,
  decideClaimV2,
  effectiveHumanObservationsV2,
  hashWorkflowValueV2,
  importHandoffV2,
  readDispositionsV2,
  sealHandoffV2,
} from "./domain";
import { projectReviewForPublicationV1 } from "./publication";
import { decodeReviewResponse, encodeReviewResponse } from "./review-transport";
import { NOW, workflowFixture } from "./test-fixtures";

describe("rate-specific judgments", () => {
  it("round trips each rate through agent, human, transport, directory, and publication without changing source coordinates", async () => {
    const f = await workflowFixture();
    const historicalBytes = serializeCanonicalJson(f.registered);
    const root = new FakeDirectoryHandle();
    const files = await root.getDirectoryHandle("workflow", { create: true });
    const file = await files.getFileHandle(`${f.inspected.source.sha256}.v2.json`, {
      create: true,
    });
    file.setText(historicalBytes);
    const directory = new WorkflowDirectoryV2(root);
    let stored = await directory.read(f.inspected.source.sha256);
    if (!stored) throw new Error("Missing seeded source.");
    expect(serializeCanonicalJson(stored.document)).toBe(historicalBytes);
    const originalFoundation = await hashWorkflowValueV2(stored.document.foundation);
    const handoff = await sealHandoffV2(f.task, {
      handoffId: "rate-comparison",
      createdAt: NOW,
      agent: f.handoff.agent,
      proposals: SUPPORTED_PLAYBACK_RATES.map((playbackRate) => ({
        ...f.claim,
        id: `rate-${playbackRate}`,
        playbackRate,
      })),
      audit: [],
      questions: [],
    });
    stored = (await directory.importHandoff(f.sourceBytes, stored.version, handoff)).stored;
    for (const proposal of handoff.proposals) {
      stored = await directory.decide(f.sourceBytes, stored.version, {
        handoffId: handoff.handoffId,
        claimId: proposal.id,
        disposition: "accepted",
        humanId: "expert",
        id: `accept-${proposal.id}`,
      });
    }
    const loaded = await directory.read(f.inspected.source.sha256);
    expect(loaded).toEqual(stored);
    const document = loaded?.document as ReviewDocumentV2;
    const observations = effectiveHumanObservationsV2(document);
    expect(observations.map(({ claim }) => claim.playbackRate)).toEqual(SUPPORTED_PLAYBACK_RATES);
    for (const { claim } of observations) {
      expect(claim.scope).toEqual(f.claim.scope);
      expect(claim.reviewContext).toEqual(f.claim.reviewContext);
      expect(claim.evidence).toEqual(f.claim.evidence);
    }
    expect(await hashWorkflowValueV2(document.foundation)).toBe(originalFoundation);
    expect(document.tasks[0]).toEqual(f.task);
    const dispositions = await readDispositionsV2(document);
    expect(dispositions.agentReviews.map(({ claim }) => claim.playbackRate)).toEqual(
      SUPPORTED_PLAYBACK_RATES,
    );
    const response = { document, dispositions };
    expect(decodeReviewResponse(JSON.parse(encodeReviewResponse(response)))).toEqual(response);
    const projection = await projectReviewForPublicationV1(document);
    expect(projection.human.map((row) => row.playback_rate)).toEqual(SUPPORTED_PLAYBACK_RATES);
    expect(projection.agents.map((row) => row.playback_rate)).toEqual(SUPPORTED_PLAYBACK_RATES);
    expect(projection.human.every((row) => row.start_ms === f.claim.scope.startMs)).toBe(true);
  });

  it("preserves legacy human hashes and keeps a new speed alongside the original judgment", async () => {
    const f = await workflowFixture();
    const original = await addHumanObservationV2(
      f.registered,
      { id: "historical", humanId: "expert", claim: f.claim },
      f.sourceBytes,
    );
    const historical = original.observations[0];
    const originalHash = await hashWorkflowValueV2(historical);
    const next = await addHumanObservationV2(
      original,
      { id: "slower", humanId: "expert", claim: { ...f.claim, playbackRate: 0.5 } },
      f.sourceBytes,
    );
    const verified = await assertReviewDocumentV2(next, f.sourceBytes);
    expect(await hashWorkflowValueV2(verified.observations[0])).toBe(originalHash);
    expect(verified.observations[0]?.claim).not.toHaveProperty("playbackRate");
    expect(
      effectiveHumanObservationsV2(verified).map(({ claim }) =>
        resolvePlaybackRate(claim.playbackRate),
      ),
    ).toEqual([1, 0.5]);
    expect(
      (await projectReviewForPublicationV1(verified)).human.map((row) => row.playback_rate),
    ).toEqual([1, 0.5]);
  });

  it("requires different rates to be new judgments for human and machine revisions, including stored reads", async () => {
    const f = await workflowFixture();
    const imported = (await importHandoffV2(f.registered, f.handoff, f.sourceBytes)).document;
    await expect(
      decideClaimV2(
        imported,
        {
          handoffId: f.handoff.handoffId,
          claimId: f.claim.id,
          disposition: "modified",
          humanId: "expert",
          modifiedClaim: { ...f.claim, playbackRate: 1.5 },
        },
        f.sourceBytes,
      ),
    ).rejects.toThrow("must retain its playback rate");
    const original = await addHumanObservationV2(
      imported,
      { id: "direct", humanId: "expert", claim: f.claim },
      f.sourceBytes,
    );
    const revision = {
      id: "revision",
      humanId: "expert",
      supersedesObservationId: `direct:${f.claim.id}`,
      claim: { ...f.claim, playbackRate: 0.75 as const },
    };
    await expect(addHumanObservationV2(original, revision, f.sourceBytes)).rejects.toThrow(
      "must retain its playback rate",
    );
    const changed = await addHumanObservationV2(
      original,
      { ...revision, claim: { ...f.claim, playbackRate: 1 } },
      f.sourceBytes,
    );
    const tampered = {
      ...changed,
      observations: changed.observations.map((observation) =>
        observation.supersedesObservationId
          ? { ...observation, claim: revision.claim }
          : observation,
      ),
    };
    await expect(assertReviewDocumentV2(tampered, f.sourceBytes)).rejects.toThrow(
      "must retain its playback rate",
    );
    const replacement = await sealHandoffV2(f.task, {
      handoffId: "changed-rate",
      createdAt: NOW,
      agent: f.handoff.agent,
      proposals: [{ ...f.claim, playbackRate: 1.25 }],
      audit: [],
      questions: [],
      supersedes: [
        {
          handoffId: f.handoff.handoffId,
          handoffSha256: await hashWorkflowValueV2(f.handoff),
          claimId: f.claim.id,
          replacementClaimId: f.claim.id,
        },
      ],
    });
    await expect(importHandoffV2(imported, replacement, f.sourceBytes)).rejects.toThrow(
      "must retain its playback rate",
    );
  });

  it("validates rate values when reading agent-authored claims", async () => {
    const f = await workflowFixture();
    expect(() => assertClaimV2({ ...f.claim, playbackRate: 2 }, f.refs, f.foundation)).toThrow(
      "Unsupported playback rate",
    );
    const proposal: ClaimV2 = { ...f.claim, playbackRate: 0.75 };
    expect(() => assertClaimV2(proposal, f.refs, f.foundation)).not.toThrow();
  });
});
