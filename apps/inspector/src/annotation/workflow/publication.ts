import { serializeCanonicalJson, sha256Hex } from "../canonical-json";
import type { SourceIdentityV1 } from "../contracts";
import { type PlaybackRate, resolvePlaybackRate } from "../playback-rate";
import type {
  AgentProvenanceV2,
  AgentReviewV2,
  ClaimV2,
  FoundationV2,
  HumanEvidenceRefV2,
  HumanObservationV2,
  ReviewDocumentV2,
} from "./contracts";
import {
  assertReviewDocumentV2,
  effectiveHumanObservationsV2,
  hashWorkflowValueV2,
  readAgentReviewsV2,
} from "./domain";

type MethodAgent = Omit<AgentProvenanceV2, "producerId">;
type AuxiliaryStatus = "current" | "changed" | "untracked" | "not-applicable";
type ClaimChangeField =
  | "tag_id"
  | "assessment"
  | "scope"
  | "playback_rate"
  | "review_context"
  | "witnesses"
  | "context_notes"
  | "rationale"
  | "section_id"
  | "boundary_uncertainty"
  | "transition"
  | "exemplar_role";
type PublicFoundation = Omit<FoundationV2, "calibrationExamples"> & {
  calibrationExamples: readonly (Omit<
    FoundationV2["calibrationExamples"][number],
    "sourceBytes"
  > & {
    sourceSha256: string;
  })[];
};
export interface PublicationRowV1 {
  record_id: string;
  source_sha256: string;
  start_ms: number;
  end_ms: number;
  playback_rate: PlaybackRate;
  tag_id: string;
  presence: ClaimV2["assessment"]["presence"];
  salience: "supporting" | "prominent" | null;
  foundation_id: string;
  origin: "human-direct" | "human-confirmed" | "human-modified" | "agent-reviewed";
  observation_id: string | null;
  /** Exact observation identity, also qualifying public auxiliary links. */
  observation_sha256?: string;
  decision_id: string | null;
  handoff_id: string | null;
  claim_id: string;
  provenance_id: string | null;
  supersedes_record_ids: string[];
  auxiliary_evidence_status: AuxiliaryStatus;
  source_status: "current" | "changed";
  foundation_status: "current" | "changed";
  review_status: string;
  method_id: string | null;
  audit_status: "supported" | "needs-revision" | "needs-expert" | "conflicting" | "missing";
  audit_supported: boolean;
  details: {
    review_context: ClaimV2["reviewContext"];
    evidence: ClaimV2["evidence"];
    evidence_review: HumanObservationV2["evidenceReview"] | null;
    proposal_changes: ClaimChangeField[] | null;
    human_revision: {
      previous_observation_id: string;
      previous_observation_sha256: string;
      changed_fields: ClaimChangeField[];
    } | null;
    human_rationale: string | null;
    section_id: string | null;
    boundary_uncertainty: ClaimV2["boundaryUncertainty"] | null;
    transition: ClaimV2["transition"] | null;
    exemplar_role: ClaimV2["exemplarRole"] | null;
    audit_results: AgentReviewV2["audits"];
  };
}
interface PacketProvenance {
  method_id: string;
  task_id: string;
  task_sha256: string;
  handoff_id: string;
  handoff_sha256: string;
  labeler_producer_id: string;
  audits: { audit_id: string; audit_sha256: string; producer_id: string }[];
  human_evidence_refs: HumanEvidenceRefV2[];
  tracking: "complete" | "partial";
}
interface EvidenceObservation {
  observation_id: string;
  observation_sha256: string;
  foundation_current: boolean;
}
export interface PublicationProjectionV1 {
  source: SourceIdentityV1;
  foundations: Record<string, PublicFoundation>;
  foundation_artifacts: Record<string, { sha256: string; content: string }>;
  human: PublicationRowV1[];
  agents: PublicationRowV1[];
  methods: Record<string, { labeler: MethodAgent; auditors: MethodAgent[] }>;
  provenance: Record<string, PacketProvenance>;
  effective_evidence: EvidenceObservation[];
}

export function humanPublicationRecordIdV1(sourceSha256: string, observationId: string): string {
  return `human:${sourceSha256}:${encodeURIComponent(observationId)}`;
}

function methodAgent(agent: AgentProvenanceV2): MethodAgent {
  const { producerId: _, ...method } = agent;
  return method;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function uniqueSorted<T>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [serializeCanonicalJson(value), value])).entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([, value]) => value);
}

function claimChanges(ancestor: ClaimV2, current: ClaimV2): ClaimChangeField[] {
  const comparisons: [ClaimChangeField, unknown, unknown][] = [
    ["tag_id", ancestor.tagId, current.tagId],
    ["assessment", ancestor.assessment, current.assessment],
    ["scope", ancestor.scope, current.scope],
    [
      "playback_rate",
      resolvePlaybackRate(ancestor.playbackRate),
      resolvePlaybackRate(current.playbackRate),
    ],
    ["review_context", ancestor.reviewContext, current.reviewContext],
    [
      "witnesses",
      uniqueSorted(ancestor.evidence.noteRefs),
      uniqueSorted(current.evidence.noteRefs),
    ],
    [
      "context_notes",
      uniqueSorted(ancestor.evidence.contextNoteRefs),
      uniqueSorted(current.evidence.contextNoteRefs),
    ],
    ["rationale", ancestor.evidence.rationale, current.evidence.rationale],
    ["section_id", ancestor.sectionId ?? null, current.sectionId ?? null],
    [
      "boundary_uncertainty",
      ancestor.boundaryUncertainty ?? null,
      current.boundaryUncertainty ?? null,
    ],
    ["transition", ancestor.transition ?? null, current.transition ?? null],
    ["exemplar_role", ancestor.exemplarRole ?? null, current.exemplarRole ?? null],
  ];
  return comparisons
    .filter(([, before, after]) => serializeCanonicalJson(before) !== serializeCanonicalJson(after))
    .map(([field]) => field);
}

function auditStatus(review: AgentReviewV2): PublicationRowV1["audit_status"] {
  const outcomes = new Set(review.audits.map(({ result }) => result.outcome));
  return outcomes.size > 1 ? "conflicting" : ([...outcomes][0] ?? "missing");
}

function rowForClaim(source: SourceIdentityV1, claim: ClaimV2): PublicationRowV1 {
  return {
    record_id: "",
    source_sha256: source.sha256,
    start_ms: claim.scope.startMs,
    end_ms: claim.scope.endMs,
    playback_rate: resolvePlaybackRate(claim.playbackRate),
    tag_id: claim.tagId,
    presence: claim.assessment.presence,
    salience: claim.assessment.presence === "present" ? claim.assessment.salience : null,
    foundation_id: "",
    origin: "agent-reviewed",
    observation_id: null,
    decision_id: null,
    handoff_id: null,
    claim_id: claim.id,
    provenance_id: null,
    supersedes_record_ids: [],
    auxiliary_evidence_status: "not-applicable",
    source_status: "current",
    foundation_status: "current",
    review_status: "human",
    method_id: null,
    audit_status: "missing",
    audit_supported: false,
    details: {
      review_context: claim.reviewContext,
      evidence: claim.evidence,
      evidence_review: null,
      proposal_changes: null,
      human_revision: null,
      human_rationale: null,
      section_id: claim.sectionId ?? null,
      boundary_uncertainty: claim.boundaryUncertainty ?? null,
      transition: claim.transition ?? null,
      exemplar_role: claim.exemplarRole ?? null,
      audit_results: [],
    },
  };
}

/** Validate source-backed V2 once, then discard its large embedded inputs after projection. */
export async function projectReviewForPublicationV1(
  input: unknown,
): Promise<PublicationProjectionV1> {
  const document = await assertReviewDocumentV2(input);
  if (!document.tasks.length)
    throw new Error("Publication requires a frozen task containing the exact source bytes.");
  const currentFoundation = await hashWorkflowValueV2(document.foundation);
  const result: PublicationProjectionV1 = {
    source: document.source,
    foundations: {},
    foundation_artifacts: {},
    human: [],
    agents: [],
    methods: {},
    provenance: {},
    effective_evidence: [],
  };
  for (const [sha, foundation] of new Map([
    [currentFoundation, document.foundation],
    ...document.tasks.map((task): [string, FoundationV2] => [
      task.foundationSha256,
      task.foundation,
    ]),
  ])) {
    const publicFoundation: PublicFoundation = {
      ...foundation,
      calibrationExamples: foundation.calibrationExamples.map(({ sourceBytes: _, ...example }) => ({
        ...example,
        sourceSha256: example.source.sha256,
      })),
    };
    const content = serializeCanonicalJson(publicFoundation);
    result.foundations[sha] = publicFoundation;
    result.foundation_artifacts[sha] = { content, sha256: await sha256Hex(content) };
  }
  const handoffProvenance = new Map<string, string>();
  for (const { handoff, handoffSha256 } of document.handoffs) {
    const audits = (document.audits ?? []).filter(
      ({ audit }) => audit.handoffId === handoff.handoffId,
    );
    const method = {
      labeler: methodAgent(handoff.agent),
      auditors: uniqueSorted(audits.map(({ audit }) => methodAgent(audit.agent))),
    };
    const methodId = `method-${await hashWorkflowValueV2(method)}`;
    result.methods[methodId] = method;
    const packets = [handoff, ...audits.map(({ audit }) => audit)];
    const provenance: PacketProvenance = {
      method_id: methodId,
      task_id: handoff.taskId,
      task_sha256: handoff.taskSha256,
      handoff_id: handoff.handoffId,
      handoff_sha256: handoffSha256,
      labeler_producer_id: handoff.agent.producerId,
      audits: audits
        .map(({ audit, auditSha256 }) => ({
          audit_id: audit.auditId,
          audit_sha256: auditSha256,
          producer_id: audit.agent.producerId,
        }))
        .sort((a, b) => compareText(a.audit_id, b.audit_id)),
      human_evidence_refs: uniqueSorted(
        packets.flatMap((packet) => packet.humanEvidenceRefs ?? []),
      ),
      tracking: packets.every((packet) => packet.humanEvidenceRefs !== undefined)
        ? "complete"
        : "partial",
    };
    const provenanceId = `provenance-${await hashWorkflowValueV2(provenance)}`;
    result.provenance[provenanceId] = provenance;
    handoffProvenance.set(handoff.handoffId, provenanceId);
  }
  const reviews = await readAgentReviewsV2(document);
  for (const review of reviews) {
    const imported = document.handoffs.find(
      ({ handoff }) => handoff.handoffId === review.handoffId,
    );
    if (!imported) throw new Error("Review has no original handoff.");
    const row = rowForClaim(document.source, review.claim);
    const provenanceId = handoffProvenance.get(review.handoffId);
    if (!provenanceId) throw new Error("Review has no recorded provenance.");
    Object.assign(row, {
      record_id: `agent:${document.source.sha256}:${encodeURIComponent(review.handoffId)}:${encodeURIComponent(review.claimId)}`,
      foundation_id: imported.handoff.foundationSha256,
      handoff_id: review.handoffId,
      decision_id: review.decision?.id ?? null,
      provenance_id: provenanceId,
      method_id: result.provenance[provenanceId]?.method_id ?? null,
      source_status: review.trust.source,
      foundation_status: review.trust.foundation,
      review_status: review.status,
      audit_status: auditStatus(review),
      audit_supported: auditStatus(review) === "supported",
    });
    row.details.audit_results = review.audits;
    result.agents.push(row);
  }
  for (const observation of effectiveHumanObservationsV2(document)) {
    const row = rowForClaim(document.source, observation.claim);
    row.record_id = humanPublicationRecordIdV1(document.source.sha256, observation.id);
    row.observation_id = observation.id;
    row.observation_sha256 = await hashWorkflowValueV2(observation);
    row.foundation_id = observation.foundationSha256;
    row.foundation_status =
      observation.foundationSha256 === currentFoundation ? "current" : "changed";
    row.origin = "human-direct";
    row.details.human_rationale = observation.claim.evidence.rationale;
    row.details.evidence_review = observation.evidenceReview ?? null;
    const ancestors = humanAncestors(document, observation);
    row.supersedes_record_ids = ancestors.map((id) =>
      humanPublicationRecordIdV1(document.source.sha256, id),
    );
    const previousId =
      observation.origin.kind === "agent-proposal" ? ancestors.at(-1) : ancestors[0];
    if (previousId) {
      const previous = document.observations.find(({ id }) => id === previousId);
      if (!previous) throw new Error("Human revision has no preceding observation.");
      row.details.human_revision = {
        previous_observation_id: previous.id,
        previous_observation_sha256: await hashWorkflowValueV2(previous),
        changed_fields: claimChanges(previous.claim, observation.claim),
      };
    }
    if (observation.origin.kind === "agent-proposal") {
      const origin = observation.origin;
      const decision = document.decisions.find((entry) => entry.id === origin.decisionId);
      const provenanceId = handoffProvenance.get(origin.handoffId);
      row.origin = decision?.disposition === "modified" ? "human-modified" : "human-confirmed";
      row.handoff_id = origin.handoffId;
      row.claim_id = origin.claimId;
      row.decision_id = origin.decisionId;
      row.provenance_id = provenanceId ?? null;
      row.method_id = provenanceId ? (result.provenance[provenanceId]?.method_id ?? null) : null;
      row.details.human_rationale = decision?.rationale ?? null;
      const proposal = document.handoffs
        .find(({ handoff }) => handoff.handoffId === origin.handoffId)
        ?.handoff.proposals.find(({ id }) => id === origin.claimId);
      if (proposal) {
        row.details.proposal_changes = claimChanges(proposal, observation.claim);
      }
    }
    result.human.push(row);
    result.effective_evidence.push({
      observation_id: observation.id,
      observation_sha256: row.observation_sha256,
      foundation_current: row.foundation_status === "current",
    });
  }
  return result;
}

function humanAncestors(document: ReviewDocumentV2, observation: HumanObservationV2): string[] {
  if (observation.origin.kind === "agent-proposal") {
    const origin = observation.origin;
    const currentIndex = document.decisions.findIndex(
      (decision) => decision.id === origin.decisionId,
    );
    return document.decisions
      .slice(0, currentIndex)
      .flatMap((decision) =>
        decision.handoffId === origin.handoffId &&
        decision.claimId === origin.claimId &&
        decision.observationId
          ? [decision.observationId]
          : [],
      );
  }
  const ancestors: string[] = [];
  let previous = observation.supersedesObservationId;
  while (previous) {
    ancestors.push(previous);
    previous = document.observations.find(
      (entry) => entry.id === previous,
    )?.supersedesObservationId;
  }
  return ancestors;
}

/** Resolve cross-chart evidence against the complete frozen inventory, even for selected exports. */
export function assemblePublicationInputV1(
  projections: readonly PublicationProjectionV1[],
  options: {
    createdAt: string;
    sourceShas?: readonly string[];
    workspaceFiles?: readonly { source_sha256: string; canonical_sha256: string }[];
    collectorFiles?: Readonly<Record<string, string>>;
  },
) {
  const evidence = new Map(
    projections.map((projection) => [
      projection.source.sha256,
      new Map(
        projection.effective_evidence.map((observation) => [
          observation.observation_id,
          observation,
        ]),
      ),
    ]),
  );
  if (evidence.size !== projections.length)
    throw new Error("Duplicate source in publication inventory.");
  for (const sha of options.sourceShas ?? [])
    if (!evidence.has(sha)) throw new Error(`Selected source is absent from workspace: ${sha}`);
  const selected = projections.filter(
    (projection) => !options.sourceShas || options.sourceShas.includes(projection.source.sha256),
  );
  const provenance = Object.assign(
    {},
    ...selected.map((projection) => projection.provenance),
  ) as Record<string, PacketProvenance>;
  const resolveStatus = (packet: PacketProvenance): AuxiliaryStatus => {
    let status: AuxiliaryStatus = packet.tracking === "complete" ? "current" : "untracked";
    for (const ref of packet.human_evidence_refs) {
      const source = evidence.get(ref.sourceSha256);
      if (!source) {
        if (status !== "changed") status = "untracked";
        continue;
      }
      const observation = source.get(ref.observationId);
      if (
        !observation?.foundation_current ||
        observation.observation_sha256 !== ref.observationSha256
      )
        status = "changed";
    }
    return status;
  };
  const rows = (key: "human" | "agents") =>
    selected
      .flatMap((projection) => projection[key])
      .map((row) => ({
        ...row,
        auxiliary_evidence_status:
          row.provenance_id && provenance[row.provenance_id]
            ? resolveStatus(provenance[row.provenance_id] as PacketProvenance)
            : "not-applicable",
      }))
      .sort((a, b) => compareText(a.record_id, b.record_id));
  return {
    contract: "beatmap-lens-release-input" as const,
    version: 1 as const,
    created_at: options.createdAt,
    collector_files: { ...options.collectorFiles },
    sources: selected
      .map((projection) => projection.source)
      .sort((a, b) => compareText(a.sha256, b.sha256)),
    foundations: Object.assign(
      {},
      ...selected.map((projection) => projection.foundations),
    ) as Record<string, PublicFoundation>,
    foundation_artifacts: Object.assign(
      {},
      ...selected.map((projection) => projection.foundation_artifacts),
    ) as PublicationProjectionV1["foundation_artifacts"],
    human: rows("human"),
    agents: rows("agents"),
    methods: Object.assign(
      {},
      ...selected.map((projection) => projection.methods),
    ) as PublicationProjectionV1["methods"],
    provenance,
    workspace_files: [...(options.workspaceFiles ?? [])].sort((a, b) =>
      compareText(a.source_sha256, b.source_sha256),
    ),
  };
}
