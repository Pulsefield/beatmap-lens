import type { SourceIdentityV1, StableNoteRefV1, TimeRangeV1 } from "../contracts";

export const WORKFLOW_CONTRACT_V2 = "beatmap-lens-agent-human-workflow" as const;
export const TASK_CONTRACT_V2 = "beatmap-lens-agent-task" as const;
export const HANDOFF_CONTRACT_V2 = "beatmap-lens-agent-handoff" as const;
export const AUDIT_CONTRACT_V2 = "beatmap-lens-independent-audit" as const;
export const FOUNDATION_CONTRACT_V2 = "beatmap-lens-judgment-foundation" as const;

export type AssessmentV2 =
  | { readonly presence: "present"; readonly salience: "supporting" | "prominent" }
  | { readonly presence: "absent" | "unresolved" | "unreviewed" };

export interface EvidenceV2 {
  readonly noteRefs: readonly StableNoteRefV1[];
  readonly contextNoteRefs: readonly StableNoteRefV1[];
  readonly rationale: string;
}

export interface ClaimV2 {
  readonly id: string;
  readonly sectionId?: string;
  readonly tagId: string;
  readonly scope: TimeRangeV1;
  readonly reviewContext: TimeRangeV1;
  readonly assessment: AssessmentV2;
  readonly evidence: EvidenceV2;
  readonly boundaryUncertainty?: {
    readonly start?: TimeRangeV1;
    readonly end?: TimeRangeV1;
  };
  readonly transition?: {
    readonly range: TimeRangeV1;
    readonly description: string;
    readonly evidence: EvidenceV2;
  };
  readonly exemplarRole?: "typical-positive" | "weak-positive" | "near-miss";
}

export interface CommunityAlignmentV2 {
  readonly catalogueUrl: string;
  readonly externalTagId: string;
  readonly relation: "aligned" | "broader" | "narrower" | "related";
  readonly scope: string;
}

export interface FoundationTagV2 {
  readonly id: string;
  readonly displayName: string;
  readonly definition: string;
  readonly inclusionCues: readonly string[];
  readonly exclusionCues: readonly string[];
  /** Legacy singular form is preserved verbatim in existing frozen snapshots. */
  readonly communityAlignment?: CommunityAlignmentV2;
  /** Local section targets may have zero or more declared external correspondences. */
  readonly communityAlignments?: readonly CommunityAlignmentV2[];
}

export interface CalibrationExampleV2 {
  readonly id: string;
  readonly source: SourceIdentityV1;
  readonly sourceBytes: readonly number[];
  readonly claim: ClaimV2;
  readonly explanation: string;
}

export interface FoundationV2 {
  readonly contract: typeof FOUNDATION_CONTRACT_V2;
  readonly version: 2;
  readonly foundationId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly policies: {
    readonly coordinates: "source-ms";
    readonly rangeConvention: "half-open";
    readonly datasetSemantics: "partially-exhaustive";
    readonly collectionPolicy: "positive-first";
    readonly saliencePolicy: "independent-per-tag-multiple-prominent";
    readonly missingAssessment: "unreviewed-not-negative";
  };
  readonly tags: readonly FoundationTagV2[];
  readonly calibrationExamples: readonly CalibrationExampleV2[];
  readonly approval:
    | { readonly status: "proposed" }
    | { readonly status: "human-approved"; readonly humanId: string; readonly approvedAt: string };
}

export interface ReviewBaseV2 {
  readonly revision: number;
  readonly sha256: string;
}

export interface TaskPacketV2 {
  readonly contract: typeof TASK_CONTRACT_V2;
  readonly version: 2;
  readonly taskId: string;
  readonly createdAt: string;
  readonly source: SourceIdentityV1;
  readonly sourceBytes: readonly number[];
  readonly structure: {
    readonly keyCount: number;
    readonly range: TimeRangeV1;
    readonly notes: readonly StableNoteRefV1[];
    readonly timingPoints: readonly {
      readonly sourceLine: number;
      readonly fields: readonly string[];
    }[];
  };
  readonly foundation: FoundationV2;
  readonly foundationSha256: string;
  readonly base: ReviewBaseV2;
  readonly taskSha256: string;
}

export interface SkillProvenanceV2 {
  readonly name: string;
  readonly version: string;
  /** Content hash of the frozen skill bundle, including its manifest and referenced guides. */
  readonly sha256: string;
}

export interface AgentProvenanceV2 {
  readonly producerId: string;
  readonly role: "labeler" | "auditor";
  readonly toolVersion?: string;
  readonly model?: string;
  readonly skill?: SkillProvenanceV2;
}

export interface HandoffV2 {
  readonly contract: typeof HANDOFF_CONTRACT_V2;
  readonly version: 2;
  readonly handoffId: string;
  readonly taskId: string;
  readonly taskSha256: string;
  readonly sourceSha256: string;
  readonly foundationSha256: string;
  readonly base: ReviewBaseV2;
  readonly createdAt: string;
  readonly agent: AgentProvenanceV2;
  readonly proposals: readonly ClaimV2[];
  readonly audit: readonly {
    readonly id: string;
    readonly claimIds: readonly string[];
    readonly finding: string;
  }[];
  readonly questions: readonly {
    readonly id: string;
    readonly claimIds: readonly string[];
    readonly text: string;
  }[];
}

export interface ImportedHandoffV2 {
  readonly handoff: HandoffV2;
  readonly handoffSha256: string;
  readonly importedAt: string;
  readonly baseStatus: "current" | "stale";
}

export type AuditClaimResultV2 = {
  readonly claimId: string;
  readonly rationale: string;
} & (
  | { readonly outcome: "supported" | "needs-revision" }
  | { readonly outcome: "needs-expert"; readonly expertReason: string; readonly question: string }
);

export interface AuditPacketV2 {
  readonly contract: typeof AUDIT_CONTRACT_V2;
  readonly version: 2;
  readonly auditId: string;
  readonly createdAt: string;
  readonly taskId: string;
  readonly taskSha256: string;
  readonly sourceSha256: string;
  readonly foundationSha256: string;
  readonly base: ReviewBaseV2;
  readonly handoffId: string;
  readonly handoffSha256: string;
  readonly agent: Omit<AgentProvenanceV2, "role"> & { readonly role: "auditor" };
  readonly claims: readonly AuditClaimResultV2[];
  readonly questions: readonly {
    readonly questionId: string;
    readonly disposition: "resolved" | "needs-revision" | "needs-expert";
    readonly rationale: string;
  }[];
}

export interface ImportedAuditV2 {
  readonly audit: AuditPacketV2;
  readonly auditSha256: string;
  readonly importedAt: string;
  readonly baseStatus: "current" | "stale";
}

export interface AgentReviewV2 {
  readonly handoffId: string;
  readonly claimId: string;
  readonly claim: ClaimV2;
  readonly status:
    | "awaiting-audit"
    | "agent-reviewed"
    | "needs-revision"
    | "needs-expert"
    | "stale"
    | HumanDecisionV2["disposition"];
  readonly baseStatus: "current" | "stale";
  readonly audits: readonly {
    readonly auditId: string;
    readonly producerId: string;
    readonly result: AuditClaimResultV2;
  }[];
  readonly rationale: string;
  readonly expertReason?: string;
  readonly question?: string;
  readonly decision?: HumanDecisionV2;
}

export interface HumanDecisionV2 {
  readonly id: string;
  readonly handoffId: string;
  readonly claimId: string;
  readonly disposition: "accepted" | "modified" | "rejected" | "deferred";
  readonly humanId: string;
  readonly decidedAt: string;
  readonly rationale: string;
  readonly observationId?: string;
}

export interface HumanObservationV2 {
  readonly id: string;
  readonly claim: ClaimV2;
  readonly foundationSha256: string;
  readonly humanId: string;
  readonly confirmedAt: string;
  readonly origin:
    | { readonly kind: "direct-human" }
    | {
        readonly kind: "agent-proposal";
        readonly handoffId: string;
        readonly claimId: string;
        readonly decisionId: string;
      };
}

export interface ReviewDocumentV2 {
  readonly contract: typeof WORKFLOW_CONTRACT_V2;
  readonly version: 2;
  readonly documentId: string;
  readonly source: SourceIdentityV1;
  readonly foundation: FoundationV2;
  readonly revision: number;
  /** Changes only when human judgment or its Foundation changes, not when exchanging files. */
  readonly reviewRevision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tasks: readonly TaskPacketV2[];
  readonly handoffs: readonly ImportedHandoffV2[];
  /** Omitted in older snapshots; independent audits never replace embedded handoff notes. */
  readonly audits?: readonly ImportedAuditV2[];
  readonly decisions: readonly HumanDecisionV2[];
  readonly observations: readonly HumanObservationV2[];
}
