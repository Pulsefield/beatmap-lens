import type { SourceIdentityV1 } from "../contracts";
import type {
  AgentProvenanceV2,
  AgentReviewV2,
  AssessmentV2,
  AuditClaimResultV2,
  ReviewBaseV2,
} from "./contracts";
import type { StoredReviewV2, WorkflowDirectoryV2 } from "./directory";

export type ReviewStoreV2 = Omit<WorkflowDirectoryV2, "registerSourceFromApprovedFoundation">;
export interface CommunityTagMetadata {
  readonly tags: readonly { readonly id: number; readonly name: string; readonly count: number }[];
  readonly totalVotes: number;
  readonly fetchedAt: string;
}
export interface RemoteSourceV2 extends StoredReviewV2 {
  readonly sourceBytes: readonly number[];
  readonly audio?: { readonly url: string; readonly filename: string } | null;
  readonly communityTags?: CommunityTagMetadata | null;
}
export interface InboxSourceV2 {
  readonly source: SourceIdentityV1;
  readonly version: ReviewBaseV2;
  readonly counts: Readonly<Record<string, number>>;
  readonly humanAssessmentCounts?: {
    readonly settled: number;
    readonly unresolved: number;
    readonly unreviewed: number;
  };
  readonly expertQueue: readonly InboxClaimV2[];
  readonly reviews: readonly InboxClaimV2[];
  readonly requests: readonly {
    requestId: string;
    handoffId: string;
    claimIds: readonly string[];
    pendingClaimIds: readonly string[];
    reason: string;
    question: string;
  }[];
}
export type InboxClaimV2 = Pick<
  AgentReviewV2,
  "handoffId" | "claimId" | "status" | "rationale" | "question" | "expertReason" | "supersededBy"
> & {
  readonly tagId: string;
  readonly scope: { readonly startMs: number; readonly endMs: number };
  readonly assessment?: AssessmentV2;
  readonly agent?: AgentProvenanceV2;
  readonly submittedAt?: string;
  readonly audits?: readonly {
    readonly auditId: string;
    readonly agent: AgentProvenanceV2;
    readonly createdAt: string;
    readonly outcome: AuditClaimResultV2["outcome"];
  }[];
};
export interface ReviewInboxV2 {
  readonly workspace: string;
  readonly sources: readonly InboxSourceV2[];
  readonly receipts: readonly { id: string; status: string; error?: string }[];
}

export async function reviewRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/review/${path}`, {
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
    cache: "no-store",
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `Review service returned ${response.status}.`);
  return value as T;
}

export function createRemoteReviewStore(sourceSha256: string): ReviewStoreV2 {
  const read = async () => {
    const { document, version } = await reviewRequest<RemoteSourceV2>(`source/${sourceSha256}`);
    return { document, version };
  };
  const command = <T>(operation: string, expectedBase: ReviewBaseV2, input: unknown) =>
    reviewRequest<T>(`human/${sourceSha256}/${operation}`, { expectedBase, input });
  const unsupported = async (): Promise<never> => {
    throw new Error("Agent exchange is delivered through the inbox service.");
  };
  return {
    read,
    initialize: read,
    registerTask: unsupported,
    importHandoff: unsupported,
    importAudit: unsupported,
    replaceProposedFoundation: unsupported,
    decide: (_bytes, base, input) => command("decide", base, input),
    addObservations: (_bytes, base, input) => command("addObservations", base, input),
    approveFoundation: (_bytes, base, humanId) => command("approveFoundation", base, { humanId }),
    exportTask: (_bytes, base, input) => command("exportTask", base, input ?? {}),
  };
}
