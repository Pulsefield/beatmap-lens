import type { HumanObservationV2, ReviewDocumentV2 } from "./contracts";
import { effectiveHumanObservationsV2 } from "./domain";
import type { InboxSourceV2 } from "./remote-workspace";

export interface ConfidenceReviewPlan {
  version: 1;
  id: string;
  title: string;
  items: ConfidenceReviewItem[];
}

export interface ConfidenceReviewItem {
  id: string;
  sourceSha256: string;
  observationIds: string[];
}

/** Includes only the current observation, with IDs of its own revision lineage. */
export function confidenceObservationSummaries(document: ReviewDocumentV2) {
  const byId = new Map(document.observations.map((observation) => [observation.id, observation]));
  return effectiveHumanObservationsV2(document).map((observation) => {
    const origin = observation.origin;
    const previousIds: string[] = [];
    if (origin.kind === "agent-proposal") {
      for (const prior of document.observations) {
        if (
          prior.id !== observation.id &&
          prior.origin.kind === "agent-proposal" &&
          prior.origin.handoffId === origin.handoffId &&
          prior.origin.claimId === origin.claimId
        )
          previousIds.push(prior.id);
      }
    } else {
      let prior: HumanObservationV2 | undefined = observation;
      while (prior?.supersedesObservationId) {
        previousIds.push(prior.supersedesObservationId);
        prior = byId.get(prior.supersedesObservationId);
      }
    }
    return {
      id: observation.id,
      previousIds,
      ...(observation.confidence ? { confidence: observation.confidence } : {}),
      tagId: observation.claim.tagId,
      scope: observation.claim.scope,
      assessment: observation.claim.assessment,
      playbackRate: observation.claim.playbackRate ?? 1,
    };
  });
}

export type ConfidenceObservationSummary = ReturnType<
  typeof confidenceObservationSummaries
>[number];

export function confidenceReviewRows(
  plan: ConfidenceReviewPlan,
  sources: readonly InboxSourceV2[],
) {
  const bySource = new Map(sources.map((source) => [source.source.sha256, source]));
  return plan.items.map((item) => {
    const source = bySource.get(item.sourceSha256);
    const targets = item.observationIds.map((id) =>
      source?.humanObservations?.find(
        (observation) => observation.id === id || observation.previousIds.includes(id),
      ),
    );
    const available = targets.length > 0 && targets.every((target) => target !== undefined);
    return {
      item,
      source,
      targets,
      available,
      completed: targets.filter((target) => target?.confidence !== undefined).length,
      complete: available && targets.every((target) => target?.confidence !== undefined),
    };
  });
}
