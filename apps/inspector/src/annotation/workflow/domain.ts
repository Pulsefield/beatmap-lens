import { serializeCanonicalJson, sha256Hex } from "../canonical-json";
import type { SourceIdentityV1, StableNoteRefV1, TimeRangeV1 } from "../contracts";
import { inspectOsuSourceV1 } from "../source-identity";
import { createStableNoteRefsV1, stableNoteRefKey } from "../stable-note-ref";
import {
  type AgentReviewV2,
  AUDIT_CONTRACT_V2,
  type AuditClaimResultV2,
  type AuditPacketV2,
  type ClaimV2,
  FOUNDATION_CONTRACT_V2,
  type FoundationV2,
  HANDOFF_CONTRACT_V2,
  type HandoffV2,
  type HumanDecisionV2,
  type HumanObservationV2,
  type ImportedAuditV2,
  type ReviewBaseV2,
  type ReviewDocumentV2,
  TASK_CONTRACT_V2,
  type TaskPacketV2,
  WORKFLOW_CONTRACT_V2,
} from "./contracts";

export interface OperationOptionsV2 {
  readonly id?: string;
  readonly now?: () => string;
}

export interface DecideClaimInputV2 extends OperationOptionsV2 {
  readonly handoffId: string;
  readonly claimId: string;
  readonly disposition: HumanDecisionV2["disposition"];
  readonly humanId: string;
  readonly rationale: string;
  readonly modifiedClaim?: ClaimV2;
}

export interface AddObservationsInputV2 extends OperationOptionsV2 {
  readonly claims: readonly ClaimV2[];
  readonly humanId: string;
}

export async function hashWorkflowValueV2(value: unknown): Promise<string> {
  return sha256Hex(serializeCanonicalJson(value));
}

/** The file version guards every write, including task and inbox bookkeeping. */
export async function reviewDocumentVersionV2(document: ReviewDocumentV2): Promise<ReviewBaseV2> {
  return { revision: document.revision, sha256: await hashWorkflowValueV2(document) };
}

/** Frozen task bases change only with human work, never merely because another file arrived. */
export async function baseForTaskV2(document: ReviewDocumentV2): Promise<ReviewBaseV2> {
  return {
    revision: document.reviewRevision,
    sha256: await hashWorkflowValueV2({
      documentId: document.documentId,
      source: document.source,
      foundation: document.foundation,
      reviewRevision: document.reviewRevision,
      decisions: document.decisions,
      observations: document.observations,
    }),
  };
}

export async function createReviewDocumentV2(
  source: SourceIdentityV1,
  foundation: FoundationV2,
  options: OperationOptionsV2 = {},
): Promise<ReviewDocumentV2> {
  await assertFoundationV2(foundation);
  const now = timestamp(options);
  return clone({
    contract: WORKFLOW_CONTRACT_V2,
    version: 2,
    documentId: options.id ?? crypto.randomUUID(),
    source,
    foundation,
    revision: 1,
    reviewRevision: 1,
    createdAt: now,
    updatedAt: now,
    tasks: [],
    handoffs: [],
    decisions: [],
    observations: [],
  });
}

export async function replaceProposedFoundationV2(
  document: ReviewDocumentV2,
  foundation: FoundationV2,
  sourceBytes: Uint8Array,
  options: OperationOptionsV2 = {},
): Promise<ReviewDocumentV2> {
  await inspectDocumentSource(document, sourceBytes);
  await assertFoundationV2(foundation);
  if (
    document.foundation.approval.status !== "proposed" ||
    foundation.approval.status !== "proposed" ||
    document.tasks.length ||
    document.decisions.length ||
    document.observations.length
  )
    throw new Error(
      "Only an unused proposed Foundation can be replaced; historical semantics are immutable.",
    );
  return changed(document, { foundation }, true, options);
}

export async function approveFoundationV2(
  document: ReviewDocumentV2,
  humanId: string,
  sourceBytes: Uint8Array,
  options: OperationOptionsV2 = {},
): Promise<ReviewDocumentV2> {
  await inspectDocumentSource(document, sourceBytes);
  nonempty(humanId, "humanId");
  if (document.foundation.approval.status === "human-approved") return document;
  const foundation: FoundationV2 = {
    ...document.foundation,
    approval: { status: "human-approved", humanId, approvedAt: timestamp(options) },
  };
  await assertFoundationV2(foundation);
  return changed(document, { foundation }, true, options);
}

export async function createTaskPacketV2(
  document: ReviewDocumentV2,
  sourceBytes: Uint8Array,
  options: { readonly taskId?: string; readonly now?: () => string } = {},
): Promise<TaskPacketV2> {
  const inspected = await inspectDocumentSource(document, sourceBytes);
  const body = {
    contract: TASK_CONTRACT_V2,
    version: 2 as const,
    taskId: options.taskId ?? crypto.randomUUID(),
    createdAt: timestamp(options),
    source: inspected.source,
    sourceBytes: Array.from(sourceBytes),
    structure: sourceStructure(inspected),
    foundation: document.foundation,
    foundationSha256: await hashWorkflowValueV2(document.foundation),
    base: await baseForTaskV2(document),
  };
  return clone({ ...body, taskSha256: await hashWorkflowValueV2(body) });
}

export async function assertTaskPacketV2(input: unknown): Promise<TaskPacketV2> {
  const task = record(
    input,
    [
      "contract",
      "version",
      "taskId",
      "createdAt",
      "source",
      "sourceBytes",
      "structure",
      "foundation",
      "foundationSha256",
      "base",
      "taskSha256",
    ],
    [],
    "task",
  );
  equal(task.contract, TASK_CONTRACT_V2, "task.contract");
  equal(task.version, 2, "task.version");
  nonempty(task.taskId, "task.taskId");
  nonempty(task.createdAt, "task.createdAt");
  assertBase(task.base, "task.base");
  const inspected = await inspectOsuSourceV1(bytes(task.sourceBytes, "task.sourceBytes"));
  same(task.source, inspected.source, "Task source identity does not match its exact .osu bytes.");
  same(
    task.structure,
    sourceStructure(inspected),
    "Task structure does not match its exact .osu bytes.",
  );
  const foundation = await assertFoundationV2(task.foundation);
  equal(task.foundationSha256, await hashWorkflowValueV2(foundation), "task.foundationSha256");
  const { taskSha256, ...body } = task;
  equal(taskSha256, await hashWorkflowValueV2(body), "task.taskSha256");
  return clone(input as TaskPacketV2);
}

export async function registerTaskV2(
  document: ReviewDocumentV2,
  input: unknown,
  sourceBytes: Uint8Array,
  options: OperationOptionsV2 = {},
): Promise<ReviewDocumentV2> {
  await inspectDocumentSource(document, sourceBytes);
  const task = await assertTaskPacketV2(input);
  same(task.source, document.source, "Source mismatch: task belongs to another exact difficulty.");
  const previous = document.tasks.find((entry) => entry.taskId === task.taskId);
  if (previous) {
    same(previous, task, "Task ID already exists with different immutable content.");
    return document;
  }
  return changed(document, { tasks: [...document.tasks, task] }, false, options);
}

export async function sealHandoffV2(
  task: TaskPacketV2,
  input: Pick<HandoffV2, "handoffId" | "createdAt" | "agent" | "proposals" | "audit" | "questions">,
): Promise<HandoffV2> {
  record(
    input,
    ["handoffId", "createdAt", "agent", "proposals", "audit", "questions"],
    [],
    "submission",
  );
  if (!array(input.proposals, "submission.proposals").length) {
    throw new Error(
      "A production handoff requires at least one source-backed claim. Standalone semantic questions belong in curator review.",
    );
  }
  return validateHandoffV2(
    {
      ...input,
      contract: HANDOFF_CONTRACT_V2,
      version: 2,
      taskId: task.taskId,
      taskSha256: task.taskSha256,
      sourceSha256: task.source.sha256,
      foundationSha256: task.foundationSha256,
      base: task.base,
    },
    task,
  );
}

export async function validateHandoffV2(input: unknown, task: TaskPacketV2): Promise<HandoffV2> {
  await assertTaskPacketV2(task);
  const handoff = record(
    input,
    [
      "contract",
      "version",
      "handoffId",
      "taskId",
      "taskSha256",
      "sourceSha256",
      "foundationSha256",
      "base",
      "createdAt",
      "agent",
      "proposals",
      "audit",
      "questions",
    ],
    [],
    "handoff",
  );
  equal(handoff.contract, HANDOFF_CONTRACT_V2, "handoff.contract");
  equal(handoff.version, 2, "handoff.version");
  nonempty(handoff.handoffId, "handoff.handoffId");
  nonempty(handoff.createdAt, "handoff.createdAt");
  equal(handoff.sourceSha256, task.source.sha256, "Source mismatch: handoff.sourceSha256");
  equal(handoff.taskId, task.taskId, "handoff.taskId");
  equal(handoff.taskSha256, task.taskSha256, "handoff.taskSha256");
  equal(handoff.foundationSha256, task.foundationSha256, "handoff.foundationSha256");
  same(handoff.base, task.base, "Handoff task base differs from its frozen task.");
  const agent = record(
    handoff.agent,
    ["producerId", "role"],
    ["toolVersion", "model", "skill"],
    "handoff.agent",
  );
  nonempty(agent.producerId, "handoff.agent.producerId");
  oneOf(agent.role, ["labeler", "auditor"], "handoff.agent.role");
  for (const key of ["toolVersion", "model"])
    if (key in agent) nonempty(agent[key], `agent.${key}`);
  if ("skill" in agent) assertSkillProvenance(agent.skill, "handoff.agent.skill");
  const proposals = array(handoff.proposals, "handoff.proposals");
  for (const claim of proposals) assertClaimV2(claim, task.structure.notes, task.foundation);
  uniqueIds(proposals, "proposals");
  const claimIds = new Set(proposals.map((claim) => (claim as ClaimV2).id));
  for (const kind of ["audit", "questions"] as const) {
    const entries = array(handoff[kind], `handoff.${kind}`);
    uniqueIds(entries, kind);
    for (const entry of entries) {
      const contentKey = kind === "audit" ? "finding" : "text";
      const value = record(entry, ["id", "claimIds", contentKey], [], kind);
      nonempty(value.id, `${kind}.id`);
      nonempty(value[contentKey], `${kind}.${contentKey}`);
      for (const id of array(value.claimIds, `${kind}.claimIds`)) {
        if (typeof id !== "string" || !claimIds.has(id))
          throw new Error(`${kind} references an unknown claim.`);
      }
    }
  }
  return clone(input as HandoffV2);
}

export async function importHandoffV2(
  document: ReviewDocumentV2,
  input: unknown,
  sourceBytes: Uint8Array,
  options: OperationOptionsV2 = {},
): Promise<{
  readonly document: ReviewDocumentV2;
  readonly status: "imported" | "duplicate";
  readonly baseStatus: "current" | "stale";
}> {
  await inspectDocumentSource(document, sourceBytes);
  const candidate = object(input, "handoff");
  equal(
    candidate.sourceSha256,
    document.source.sha256,
    "Source mismatch: handoff belongs to another exact difficulty",
  );
  const task = document.tasks.find((entry) => entry.taskId === candidate.taskId);
  if (!task)
    throw new Error("Unknown task: open its frozen task packet before importing the handoff.");
  const handoff = await validateHandoffV2(input, task);
  const handoffSha256 = await hashWorkflowValueV2(handoff);
  const existing = document.handoffs.find((entry) => entry.handoff.handoffId === handoff.handoffId);
  if (existing) {
    equal(
      handoffSha256,
      existing.handoffSha256,
      "Handoff ID already exists with different immutable content",
    );
    return { document, status: "duplicate", baseStatus: existing.baseStatus };
  }
  const baseStatus: "current" | "stale" = sameBase(handoff.base, await baseForTaskV2(document))
    ? "current"
    : "stale";
  const imported = { handoff, handoffSha256, baseStatus, importedAt: timestamp(options) };
  return {
    document: changed(document, { handoffs: [...document.handoffs, imported] }, false, options),
    status: "imported",
    baseStatus,
  };
}

export async function sealAuditV2(
  task: TaskPacketV2,
  handoff: HandoffV2,
  input: Pick<AuditPacketV2, "auditId" | "createdAt" | "agent" | "claims" | "questions">,
): Promise<AuditPacketV2> {
  record(input, ["auditId", "createdAt", "agent", "claims", "questions"], [], "audit submission");
  return validateAuditV2(
    {
      ...input,
      contract: AUDIT_CONTRACT_V2,
      version: 2,
      taskId: task.taskId,
      taskSha256: task.taskSha256,
      sourceSha256: task.source.sha256,
      foundationSha256: task.foundationSha256,
      base: task.base,
      handoffId: handoff.handoffId,
      handoffSha256: await hashWorkflowValueV2(handoff),
    },
    task,
    handoff,
  );
}

export async function validateAuditV2(
  input: unknown,
  task: TaskPacketV2,
  handoff: HandoffV2,
): Promise<AuditPacketV2> {
  await validateHandoffV2(handoff, task);
  equal(handoff.agent.role, "labeler", "Independent audit target must be a labeler handoff");
  if (!handoff.proposals.length) {
    throw new Error(
      "An independent production audit requires at least one original claim. Standalone semantic questions belong in curator review.",
    );
  }
  const audit = record(
    input,
    [
      "contract",
      "version",
      "auditId",
      "createdAt",
      "taskId",
      "taskSha256",
      "sourceSha256",
      "foundationSha256",
      "base",
      "handoffId",
      "handoffSha256",
      "agent",
      "claims",
      "questions",
    ],
    [],
    "audit",
  );
  equal(audit.contract, AUDIT_CONTRACT_V2, "audit.contract");
  equal(audit.version, 2, "audit.version");
  nonempty(audit.auditId, "audit.auditId");
  nonempty(audit.createdAt, "audit.createdAt");
  equal(audit.sourceSha256, task.source.sha256, "Source mismatch: audit.sourceSha256");
  equal(audit.taskId, task.taskId, "audit.taskId");
  equal(audit.taskSha256, task.taskSha256, "audit.taskSha256");
  equal(audit.foundationSha256, task.foundationSha256, "audit.foundationSha256");
  same(audit.base, task.base, "Audit base differs from the frozen task.");
  equal(audit.handoffId, handoff.handoffId, "audit.handoffId");
  equal(audit.handoffSha256, await hashWorkflowValueV2(handoff), "audit.handoffSha256");
  const agent = record(
    audit.agent,
    ["producerId", "role"],
    ["toolVersion", "model", "skill"],
    "audit.agent",
  );
  equal(agent.role, "auditor", "audit.agent.role");
  nonempty(agent.producerId, "audit.agent.producerId");
  if (agent.producerId.trim() === handoff.agent.producerId.trim()) {
    throw new Error("An independent auditor must have a different producerId from the labeler.");
  }
  for (const key of ["toolVersion", "model"])
    if (key in agent) nonempty(agent[key], `audit.agent.${key}`);
  if ("skill" in agent) assertSkillProvenance(agent.skill, "audit.agent.skill");
  const claims = array(audit.claims, "audit.claims");
  for (const entry of claims) {
    const result = object(entry, "audit claim");
    const required = ["claimId", "outcome", "rationale"];
    record(
      result,
      result.outcome === "needs-expert" ? [...required, "expertReason", "question"] : required,
      [],
      "audit claim",
    );
    nonempty(result.claimId, "audit claim.claimId");
    nonempty(result.rationale, "audit claim.rationale");
    oneOf(result.outcome, ["supported", "needs-revision", "needs-expert"], "audit claim.outcome");
    if (result.outcome === "needs-expert") {
      nonempty(result.expertReason, "audit claim.expertReason");
      nonempty(result.question, "audit claim.question");
    }
    const proposal = handoff.proposals.find((claim) => claim.id === result.claimId);
    if (!proposal) throw new Error("Audit result references an unknown original claim.");
    if (
      result.outcome === "supported" &&
      ["unresolved", "unreviewed"].includes(proposal.assessment.presence)
    ) {
      throw new Error(
        "An unresolved or unreviewed proposal needs revision or expert review; it cannot be supported as a settled claim.",
      );
    }
  }
  exactCoverage(
    claims,
    "claimId",
    handoff.proposals.map((claim) => claim.id),
    "audit.claims",
  );
  const questions = array(audit.questions, "audit.questions");
  for (const entry of questions) {
    const disposition = record(
      entry,
      ["questionId", "disposition", "rationale"],
      [],
      "audit question",
    );
    nonempty(disposition.questionId, "audit question.questionId");
    nonempty(disposition.rationale, "audit question.rationale");
    oneOf(
      disposition.disposition,
      ["resolved", "needs-revision", "needs-expert"],
      "audit question.disposition",
    );
    const original = handoff.questions.find((question) => question.id === disposition.questionId);
    if (!original)
      throw new Error("Audit question disposition references an unknown original question.");
    if (disposition.disposition === "resolved") continue;
    const affectedIds = original.claimIds.length
      ? original.claimIds
      : handoff.proposals.map((claim) => claim.id);
    for (const claimId of affectedIds) {
      const result = claims.find(
        (entry) => (entry as AuditClaimResultV2).claimId === claimId,
      ) as AuditClaimResultV2;
      if (result.outcome === "supported")
        throw new Error(
          "A supported claim cannot leave an associated original question unresolved.",
        );
      if (disposition.disposition === "needs-expert" && result.outcome !== "needs-expert") {
        throw new Error(
          "An original question needing an expert must keep each affected claim in expert review.",
        );
      }
    }
  }
  exactCoverage(
    questions,
    "questionId",
    handoff.questions.map((question) => question.id),
    "audit.questions",
  );
  return clone(input as AuditPacketV2);
}

export async function importAuditV2(
  document: ReviewDocumentV2,
  input: unknown,
  sourceBytes: Uint8Array,
  options: OperationOptionsV2 = {},
): Promise<{
  readonly document: ReviewDocumentV2;
  readonly status: "imported" | "duplicate";
  readonly baseStatus: "current" | "stale";
}> {
  await inspectDocumentSource(document, sourceBytes);
  const candidate = object(input, "audit");
  equal(
    candidate.sourceSha256,
    document.source.sha256,
    "Source mismatch: audit belongs to another exact difficulty",
  );
  const task = document.tasks.find((entry) => entry.taskId === candidate.taskId);
  const handoff = document.handoffs.find(
    (entry) => entry.handoff.handoffId === candidate.handoffId,
  )?.handoff;
  if (!task || !handoff)
    throw new Error(
      "Import the original frozen task and labeler handoff before its independent audit.",
    );
  const audit = await validateAuditV2(input, task, handoff);
  const auditSha256 = await hashWorkflowValueV2(audit);
  const existing = document.audits?.find((entry) => entry.audit.auditId === audit.auditId);
  if (existing) {
    equal(
      auditSha256,
      existing.auditSha256,
      "Audit ID already exists with different immutable content",
    );
    return {
      document,
      status: "duplicate",
      baseStatus: await handoffBaseStatusV2(document, handoff.handoffId),
    };
  }
  const baseStatus = await handoffBaseStatusV2(document, handoff.handoffId);
  const imported: ImportedAuditV2 = {
    audit,
    auditSha256,
    importedAt: timestamp(options),
    baseStatus,
  };
  return {
    document: changed(document, { audits: [...(document.audits ?? []), imported] }, false, options),
    status: "imported",
    baseStatus,
  };
}

export async function decideClaimV2(
  document: ReviewDocumentV2,
  input: DecideClaimInputV2,
  sourceBytes: Uint8Array,
): Promise<ReviewDocumentV2> {
  const inspected = await inspectDocumentSource(document, sourceBytes);
  nonempty(input.humanId, "humanId");
  oneOf(input.disposition, ["accepted", "modified", "rejected", "deferred"], "disposition");
  const imported = document.handoffs.find((entry) => entry.handoff.handoffId === input.handoffId);
  const proposal = imported?.handoff.proposals.find((claim) => claim.id === input.claimId);
  if (!imported || !proposal) throw new Error("Unknown handoff claim.");
  const previous = document.decisions
    .filter(
      (decision) => decision.handoffId === input.handoffId && decision.claimId === input.claimId,
    )
    .at(-1);
  if (previous && previous.disposition !== "deferred")
    throw new Error(
      "This claim already has a final human decision; its history cannot be overwritten.",
    );
  const confirming = input.disposition === "accepted" || input.disposition === "modified";
  if (confirming && (await handoffBaseStatusV2(document, input.handoffId)) === "stale")
    throw new Error(
      "Stale task base: export a fresh task and explicitly review its updated proposal before confirming.",
    );
  // Decisions within the same imported handoff are independent: accepting one must not stale its siblings.
  if (confirming) {
    requireApproved(document.foundation);
    equal(
      imported.handoff.foundationSha256,
      await hashWorkflowValueV2(document.foundation),
      "Foundation changed: export a fresh task before confirming",
    );
  }
  if (input.disposition === "modified" && !input.modifiedClaim)
    throw new Error("A modified decision requires the complete revised claim.");
  if (input.disposition !== "modified" && input.modifiedClaim)
    throw new Error("Only a modified human decision may supply a revised claim.");
  const claim = input.modifiedClaim ?? proposal;
  assertClaimV2(claim, createStableNoteRefsV1(inspected.chart), document.foundation);
  if (confirming && ["unresolved", "unreviewed"].includes(claim.assessment.presence))
    throw new Error(
      "Choose present with salience or absent before confirming a proposal, or defer this review. Unresolved and unreviewed do not decide presence.",
    );
  equal(claim.id, proposal.id, "Modified claim identity");
  const id = input.id ?? crypto.randomUUID();
  if (document.decisions.some((decision) => decision.id === id))
    throw new Error("Human decision ID already exists.");
  const decidedAt = timestamp(input);
  const observationId = `${id}:observation`;
  const decision: HumanDecisionV2 = {
    id,
    handoffId: input.handoffId,
    claimId: input.claimId,
    disposition: input.disposition,
    humanId: input.humanId,
    rationale: input.rationale,
    decidedAt,
    ...(confirming ? { observationId } : {}),
  };
  const observation: HumanObservationV2 = {
    id: observationId,
    claim,
    foundationSha256: imported.handoff.foundationSha256,
    humanId: input.humanId,
    confirmedAt: decidedAt,
    origin: {
      kind: "agent-proposal",
      handoffId: input.handoffId,
      claimId: input.claimId,
      decisionId: id,
    },
  };
  return changed(
    document,
    {
      decisions: [...document.decisions, decision],
      observations: confirming ? [...document.observations, observation] : document.observations,
    },
    true,
    input,
  );
}

export async function addHumanObservationsV2(
  document: ReviewDocumentV2,
  input: AddObservationsInputV2,
  sourceBytes: Uint8Array,
): Promise<ReviewDocumentV2> {
  const inspected = await inspectDocumentSource(document, sourceBytes);
  requireApproved(document.foundation);
  nonempty(input.humanId, "humanId");
  if (!input.claims.length) throw new Error("At least one claim is required.");
  uniqueIds(input.claims, "claims");
  const refs = createStableNoteRefsV1(inspected.chart);
  for (const claim of input.claims) assertClaimV2(claim, refs, document.foundation);
  const foundationSha256 = await hashWorkflowValueV2(document.foundation);
  const confirmedAt = timestamp(input);
  const groupId = input.id ?? crypto.randomUUID();
  const observations = input.claims.map(
    (claim): HumanObservationV2 => ({
      id: `${groupId}:${claim.id}`,
      claim,
      foundationSha256,
      humanId: input.humanId,
      confirmedAt,
      origin: { kind: "direct-human" },
    }),
  );
  uniqueIds([...document.observations, ...observations], "observations");
  return changed(
    document,
    { observations: [...document.observations, ...observations] },
    true,
    input,
  );
}

export async function addHumanObservationV2(
  document: ReviewDocumentV2,
  input: OperationOptionsV2 & { readonly claim: ClaimV2; readonly humanId: string },
  sourceBytes: Uint8Array,
): Promise<ReviewDocumentV2> {
  return addHumanObservationsV2(document, { ...input, claims: [input.claim] }, sourceBytes);
}

export async function readAgentReviewsV2(
  document: ReviewDocumentV2,
): Promise<readonly AgentReviewV2[]> {
  const rows = await Promise.all(
    document.handoffs.map(async ({ handoff }) => {
      const baseStatus = await handoffBaseStatusV2(document, handoff.handoffId);
      return handoff.proposals.map((claim): AgentReviewV2 => {
        const audits = (document.audits ?? [])
          .filter((entry) => entry.audit.handoffId === handoff.handoffId)
          .flatMap(({ audit }) => {
            const result = audit.claims.find((result) => result.claimId === claim.id);
            return result
              ? [{ auditId: audit.auditId, producerId: audit.agent.producerId, result }]
              : [];
          });
        const decision = document.decisions
          .filter(
            (decision) => decision.handoffId === handoff.handoffId && decision.claimId === claim.id,
          )
          .at(-1);
        const common = {
          handoffId: handoff.handoffId,
          claimId: claim.id,
          claim,
          baseStatus,
          audits,
        };
        if (decision)
          return {
            ...common,
            status: decision.disposition,
            rationale: decision.rationale,
            decision,
          };
        const rationale = audits
          .map((audit) => `${audit.producerId}: ${audit.result.rationale}`)
          .join("\n");
        if (baseStatus === "stale") return { ...common, status: "stale", rationale };
        if (!audits.length) return { ...common, status: "awaiting-audit", rationale: "" };
        const outcomes = new Set(audits.map((audit) => audit.result.outcome));
        if (outcomes.size > 1)
          return {
            ...common,
            status: "needs-expert",
            rationale,
            expertReason: "conflicting-audits",
            question:
              "Independent audit outcomes disagree. Which judgment should apply to this original claim?",
          };
        if (outcomes.has("supported")) return { ...common, status: "agent-reviewed", rationale };
        if (outcomes.has("needs-revision"))
          return { ...common, status: "needs-revision", rationale };
        const expertFindings = audits.flatMap(({ result }) =>
          result.outcome === "needs-expert" ? [result] : [],
        );
        return {
          ...common,
          status: "needs-expert",
          rationale,
          expertReason: [...new Set(expertFindings.map((result) => result.expertReason))].join(
            "; ",
          ),
          question: [...new Set(expertFindings.map((result) => result.question))].join("\n"),
        };
      });
    }),
  );
  return rows.flat();
}

export async function readExpertQueueV2(
  document: ReviewDocumentV2,
): Promise<readonly AgentReviewV2[]> {
  return (await readAgentReviewsV2(document)).filter((review) => review.status === "needs-expert");
}

export async function readDispositionsV2(document: ReviewDocumentV2) {
  return {
    contract: "beatmap-lens-human-dispositions" as const,
    version: 2 as const,
    source: document.source,
    reviewRevision: document.reviewRevision,
    audits: document.audits ?? [],
    agentReviews: await readAgentReviewsV2(document),
    handoffs: await Promise.all(
      document.handoffs.map(async (entry) => ({
        handoffId: entry.handoff.handoffId,
        agent: entry.handoff.agent,
        taskId: entry.handoff.taskId,
        taskSha256: entry.handoff.taskSha256,
        foundationSha256: entry.handoff.foundationSha256,
        baseStatus: await handoffBaseStatusV2(document, entry.handoff.handoffId),
        importedBaseStatus: entry.baseStatus,
        audit: entry.handoff.audit,
        questions: entry.handoff.questions,
        claims: entry.handoff.proposals.map((proposal) => ({
          proposal,
          decisions: document.decisions.filter(
            (decision) =>
              decision.handoffId === entry.handoff.handoffId && decision.claimId === proposal.id,
          ),
          observations: document.observations.filter(
            (observation) =>
              observation.origin.kind === "agent-proposal" &&
              observation.origin.handoffId === entry.handoff.handoffId &&
              observation.origin.claimId === proposal.id,
          ),
        })),
      })),
    ),
    directObservations: document.observations.filter(
      (observation) => observation.origin.kind === "direct-human",
    ),
  };
}

export async function handoffBaseStatusV2(
  document: ReviewDocumentV2,
  handoffId: string,
): Promise<"current" | "stale"> {
  const imported = document.handoffs.find((entry) => entry.handoff.handoffId === handoffId);
  if (!imported) throw new Error("Unknown handoff.");
  if (imported.baseStatus === "stale") return "stale";
  const ownDecisions = document.decisions.filter((decision) => decision.handoffId === handoffId);
  const beforeOwnDecisions = {
    ...document,
    reviewRevision: document.reviewRevision - ownDecisions.length,
    decisions: document.decisions.filter((decision) => decision.handoffId !== handoffId),
    observations: document.observations.filter(
      (observation) =>
        observation.origin.kind !== "agent-proposal" || observation.origin.handoffId !== handoffId,
    ),
  };
  return sameBase(imported.handoff.base, await baseForTaskV2(beforeOwnDecisions))
    ? "current"
    : "stale";
}

export async function assertFoundationV2(input: unknown): Promise<FoundationV2> {
  const foundation = record(
    input,
    [
      "contract",
      "version",
      "foundationId",
      "revision",
      "createdAt",
      "policies",
      "tags",
      "calibrationExamples",
      "approval",
    ],
    [],
    "foundation",
  );
  equal(foundation.contract, FOUNDATION_CONTRACT_V2, "foundation.contract");
  equal(foundation.version, 2, "foundation.version");
  nonempty(foundation.foundationId, "foundation.foundationId");
  positiveInteger(foundation.revision, "foundation.revision");
  nonempty(foundation.createdAt, "foundation.createdAt");
  same(
    foundation.policies,
    {
      coordinates: "source-ms",
      rangeConvention: "half-open",
      datasetSemantics: "partially-exhaustive",
      collectionPolicy: "positive-first",
      saliencePolicy: "independent-per-tag-multiple-prominent",
      missingAssessment: "unreviewed-not-negative",
    },
    "Unsupported Foundation V2 policies.",
  );
  const tags = array(foundation.tags, "foundation.tags");
  if (!tags.length) throw new Error("Foundation vocabulary is empty.");
  uniqueIds(tags, "foundation.tags");
  for (const entry of tags) {
    const tag = record(
      entry,
      ["id", "displayName", "definition", "inclusionCues", "exclusionCues"],
      ["communityAlignment", "communityAlignments"],
      "tag",
    );
    for (const key of ["id", "displayName", "definition"]) nonempty(tag[key], `tag.${key}`);
    for (const key of ["inclusionCues", "exclusionCues"])
      for (const cue of array(tag[key], `tag.${key}`)) nonempty(cue, `tag.${key}`);
    if ("communityAlignment" in tag && "communityAlignments" in tag) {
      throw new Error("A tag cannot declare both communityAlignment and communityAlignments.");
    }
    const alignments =
      "communityAlignment" in tag
        ? [tag.communityAlignment]
        : "communityAlignments" in tag
          ? array(tag.communityAlignments, "tag.communityAlignments")
          : [];
    for (const entry of alignments) {
      const alignment = record(
        entry,
        ["catalogueUrl", "externalTagId", "relation", "scope"],
        [],
        "communityAlignment",
      );
      for (const key of ["catalogueUrl", "externalTagId", "scope"])
        nonempty(alignment[key], `communityAlignment.${key}`);
      oneOf(
        alignment.relation,
        ["aligned", "broader", "narrower", "related"],
        "communityAlignment.relation",
      );
    }
  }
  const approval = object(foundation.approval, "foundation.approval");
  if (approval.status === "proposed") record(approval, ["status"], [], "approval");
  else {
    record(approval, ["status", "humanId", "approvedAt"], [], "approval");
    equal(approval.status, "human-approved", "approval.status");
    nonempty(approval.humanId, "approval.humanId");
    nonempty(approval.approvedAt, "approval.approvedAt");
  }
  const examples = array(foundation.calibrationExamples, "foundation.calibrationExamples");
  uniqueIds(examples, "calibrationExamples");
  for (const entry of examples) {
    const example = record(
      entry,
      ["id", "source", "sourceBytes", "claim", "explanation"],
      [],
      "example",
    );
    nonempty(example.id, "example.id");
    nonempty(example.explanation, "example.explanation");
    const inspected = await inspectOsuSourceV1(bytes(example.sourceBytes, "example.sourceBytes"));
    same(
      example.source,
      inspected.source,
      "Calibration example source differs from its exact bytes.",
    );
    assertClaimV2(example.claim, createStableNoteRefsV1(inspected.chart), input as FoundationV2);
  }
  if (approval.status === "human-approved" && !examples.length)
    throw new Error("Foundation approval requires source-backed calibration examples.");
  return clone(input as FoundationV2);
}

export function assertClaimV2(
  input: unknown,
  sourceNotes: readonly StableNoteRefV1[],
  foundation: FoundationV2,
): asserts input is ClaimV2 {
  const claim = record(
    input,
    ["id", "tagId", "scope", "reviewContext", "assessment", "evidence"],
    ["sectionId", "boundaryUncertainty", "transition", "exemplarRole"],
    "claim",
  );
  nonempty(claim.id, "claim.id");
  if ("sectionId" in claim) nonempty(claim.sectionId, "claim.sectionId");
  if (!foundation.tags.some((tag) => tag.id === claim.tagId))
    throw new Error(`Unknown Foundation tag ${String(claim.tagId)}.`);
  const scope = range(claim.scope, "claim.scope");
  const context = range(claim.reviewContext, "claim.reviewContext");
  if (context.startMs > scope.startMs || context.endMs < scope.endMs)
    throw new Error("Review context must contain the whole claim scope.");
  const assessment = object(claim.assessment, "assessment");
  oneOf(
    assessment.presence,
    ["present", "absent", "unresolved", "unreviewed"],
    "assessment.presence",
  );
  if (assessment.presence === "present") {
    record(assessment, ["presence", "salience"], [], "assessment");
    oneOf(assessment.salience, ["supporting", "prominent"], "assessment.salience");
  } else record(assessment, ["presence"], [], "assessment");
  const evidence = assertEvidence(claim.evidence, scope, context, sourceNotes, "claim.evidence");
  if (assessment.presence !== "unreviewed")
    nonempty(evidence.rationale, "claim.evidence.rationale");
  if (assessment.presence === "present" && !evidence.noteRefs.length)
    throw new Error("A positive claim requires source-backed witness notes.");
  if ("boundaryUncertainty" in claim) {
    const boundary = record(claim.boundaryUncertainty, [], ["start", "end"], "boundaryUncertainty");
    if (!Object.keys(boundary).length)
      throw new Error("Boundary uncertainty requires at least one cut range.");
    for (const key of ["start", "end"] as const)
      if (key in boundary) {
        const cut = range(boundary[key], `boundaryUncertainty.${key}`);
        const center = key === "start" ? scope.startMs : scope.endMs;
        if (
          cut.startMs > center ||
          cut.endMs < center ||
          cut.startMs < context.startMs ||
          cut.endMs > context.endMs
        )
          throw new Error(
            "Boundary uncertainty must contain its declared cut and remain inside review context.",
          );
      }
  }
  if ("transition" in claim) {
    const transition = record(
      claim.transition,
      ["range", "description", "evidence"],
      [],
      "transition",
    );
    const interval = range(transition.range, "transition.range");
    if (interval.startMs < scope.startMs || interval.endMs > scope.endMs)
      throw new Error("Transition range must be inside the claim scope.");
    nonempty(transition.description, "transition.description");
    const transitionEvidence = assertEvidence(
      transition.evidence,
      interval,
      context,
      sourceNotes,
      "transition.evidence",
    );
    nonempty(transitionEvidence.rationale, "transition.evidence.rationale");
    if (!transitionEvidence.noteRefs.length)
      throw new Error("A transition needs its own source-backed evidence.");
  }
  if ("exemplarRole" in claim) {
    oneOf(claim.exemplarRole, ["typical-positive", "weak-positive", "near-miss"], "exemplarRole");
  }
}

export async function assertReviewDocumentV2(
  input: unknown,
  sourceBytes?: Uint8Array,
): Promise<ReviewDocumentV2> {
  await validateReviewDocumentV2(input, sourceBytes);
  return clone(input as ReviewDocumentV2);
}

/** Validate a fresh directory-owned graph without duplicating immutable source snapshots. */
export async function validateReviewDocumentV2(
  input: unknown,
  sourceBytes?: Uint8Array,
): Promise<void> {
  const value = record(
    input,
    [
      "contract",
      "version",
      "documentId",
      "source",
      "foundation",
      "revision",
      "reviewRevision",
      "createdAt",
      "updatedAt",
      "tasks",
      "handoffs",
      "decisions",
      "observations",
    ],
    ["audits"],
    "review",
  );
  equal(value.contract, WORKFLOW_CONTRACT_V2, "review.contract");
  equal(value.version, 2, "review.version");
  for (const key of ["documentId", "createdAt", "updatedAt"]) nonempty(value[key], `review.${key}`);
  positiveInteger(value.revision, "review.revision");
  positiveInteger(value.reviewRevision, "review.reviewRevision");
  const foundation = await assertFoundationV2(value.foundation);
  const document = input as ReviewDocumentV2;
  const tasks = array(value.tasks, "review.tasks");
  uniqueIds(
    tasks.map((entry) => ({ id: object(entry, "task").taskId })),
    "tasks",
  );
  for (const entry of tasks) {
    const task = await assertTaskPacketV2(entry);
    same(task.source, value.source, "Stored task source differs from review source.");
  }
  const bytesToInspect =
    sourceBytes ?? (document.tasks[0] ? Uint8Array.from(document.tasks[0].sourceBytes) : undefined);
  const inspected = bytesToInspect
    ? await inspectDocumentSource(document, bytesToInspect)
    : undefined;
  const handoffs = array(value.handoffs, "review.handoffs");
  const handoffIds: { id: unknown }[] = [];
  for (const entry of handoffs) {
    const imported = record(
      entry,
      ["handoff", "handoffSha256", "importedAt", "baseStatus"],
      [],
      "importedHandoff",
    );
    const candidate = object(imported.handoff, "handoff");
    const task = document.tasks.find((task) => task.taskId === candidate.taskId);
    if (!task) throw new Error("Stored handoff has no frozen task.");
    const handoff = await validateHandoffV2(imported.handoff, task);
    equal(imported.handoffSha256, await hashWorkflowValueV2(handoff), "handoffSha256");
    oneOf(imported.baseStatus, ["current", "stale"], "baseStatus");
    nonempty(imported.importedAt, "importedAt");
    handoffIds.push({ id: handoff.handoffId });
  }
  uniqueIds(handoffIds, "handoffs");
  if ("audits" in value) {
    const auditIds: { id: unknown }[] = [];
    for (const entry of array(value.audits, "review.audits")) {
      const imported = record(
        entry,
        ["audit", "auditSha256", "importedAt", "baseStatus"],
        [],
        "importedAudit",
      );
      const candidate = object(imported.audit, "audit");
      const task = document.tasks.find((task) => task.taskId === candidate.taskId);
      const handoff = document.handoffs.find(
        (entry) => entry.handoff.handoffId === candidate.handoffId,
      )?.handoff;
      if (!task || !handoff)
        throw new Error("Stored audit has no frozen task and original handoff.");
      const audit = await validateAuditV2(imported.audit, task, handoff);
      equal(imported.auditSha256, await hashWorkflowValueV2(audit), "auditSha256");
      oneOf(imported.baseStatus, ["current", "stale"], "audit.baseStatus");
      nonempty(imported.importedAt, "audit.importedAt");
      auditIds.push({ id: audit.auditId });
    }
    uniqueIds(auditIds, "audits");
  }
  array(value.decisions, "review.decisions");
  array(value.observations, "review.observations");
  uniqueIds(document.decisions, "decisions");
  uniqueIds(document.observations, "observations");
  const pinned = new Map<string, FoundationV2>([
    [await hashWorkflowValueV2(foundation), foundation],
  ]);
  for (const task of document.tasks) pinned.set(task.foundationSha256, task.foundation);
  for (const observation of document.observations) {
    record(
      observation,
      ["id", "claim", "foundationSha256", "humanId", "confirmedAt", "origin"],
      [],
      "observation",
    );
    nonempty(observation.humanId, "observation.humanId");
    nonempty(observation.confirmedAt, "observation.confirmedAt");
    const rules = pinned.get(observation.foundationSha256);
    if (!rules) throw new Error("Observation Foundation is missing.");
    requireApproved(rules);
    if (!inspected)
      throw new Error("Exact source bytes are required to verify human observations.");
    assertClaimV2(observation.claim, createStableNoteRefsV1(inspected.chart), rules);
    const origin = object(observation.origin, "origin");
    if (origin.kind === "direct-human") record(origin, ["kind"], [], "origin");
    else {
      record(origin, ["kind", "handoffId", "claimId", "decisionId"], [], "origin");
      equal(origin.kind, "agent-proposal", "origin.kind");
      const decision = document.decisions.find((entry) => entry.id === origin.decisionId);
      if (
        !decision ||
        decision.observationId !== observation.id ||
        decision.handoffId !== origin.handoffId ||
        decision.claimId !== origin.claimId ||
        decision.humanId !== observation.humanId ||
        decision.decidedAt !== observation.confirmedAt
      )
        throw new Error("Observation does not match its human decision provenance.");
    }
  }
  for (const decision of document.decisions) {
    record(
      decision,
      ["id", "handoffId", "claimId", "disposition", "humanId", "decidedAt", "rationale"],
      ["observationId"],
      "decision",
    );
    nonempty(decision.humanId, "decision.humanId");
    nonempty(decision.decidedAt, "decision.decidedAt");
    if (typeof decision.rationale !== "string") throw new Error("Decision rationale must be text.");
    oneOf(
      decision.disposition,
      ["accepted", "modified", "rejected", "deferred"],
      "decision.disposition",
    );
    const handoff = document.handoffs.find(
      (entry) => entry.handoff.handoffId === decision.handoffId,
    );
    const proposal = handoff?.handoff.proposals.find((entry) => entry.id === decision.claimId);
    if (!proposal) throw new Error("Decision has no original proposal.");
    const confirming = decision.disposition === "accepted" || decision.disposition === "modified";
    const observation = document.observations.find((entry) => entry.id === decision.observationId);
    if (confirming !== Boolean(observation) || (!confirming && decision.observationId))
      throw new Error("Only accepted or modified decisions produce observations.");
    if (decision.disposition === "accepted")
      same(observation?.claim, proposal, "Accepted observation changed the original claim.");
  }
}

export function sameBase(left: ReviewBaseV2, right: ReviewBaseV2): boolean {
  return left.revision === right.revision && left.sha256 === right.sha256;
}

function sourceStructure(
  inspected: Awaited<ReturnType<typeof inspectOsuSourceV1>>,
): TaskPacketV2["structure"] {
  return {
    keyCount: inspected.chart.keyCount,
    range: inspected.chart.range,
    notes: createStableNoteRefsV1(inspected.chart),
    timingPoints: inspected.parsed.sections
      .filter((section) => section.name.toLowerCase() === "timingpoints")
      .flatMap((section) =>
        section.dataLines.map((line) => ({ sourceLine: line.number, fields: line.fields ?? [] })),
      ),
  };
}

async function inspectDocumentSource(document: ReviewDocumentV2, sourceBytes: Uint8Array) {
  const inspected = await inspectOsuSourceV1(sourceBytes);
  same(
    document.source,
    inspected.source,
    "Source mismatch: exact .osu bytes differ from the review difficulty.",
  );
  return inspected;
}

function assertEvidence(
  input: unknown,
  scope: TimeRangeV1,
  context: TimeRangeV1,
  sourceNotes: readonly StableNoteRefV1[],
  path: string,
) {
  const evidence = record(input, ["noteRefs", "contextNoteRefs", "rationale"], [], path);
  if (typeof evidence.rationale !== "string") throw new Error(`${path}.rationale must be text.`);
  const known = new Map(sourceNotes.map((ref) => [stableNoteRefKey(ref), ref]));
  for (const key of ["noteRefs", "contextNoteRefs"] as const) {
    const refs = array(evidence[key], `${path}.${key}`);
    const seen = new Set<string>();
    for (const inputRef of refs) {
      const ref = record(
        inputRef,
        ["sourceLine", "column", "kind", "startMs", "endMs"],
        [],
        `${path}.${key}`,
      ) as unknown as StableNoteRefV1;
      const referenceKey = stableNoteRefKey(ref);
      if (!known.has(referenceKey))
        throw new Error(`${path}: note reference does not resolve in the exact source.`);
      same(
        inputRef,
        known.get(referenceKey),
        `${path}: note reference differs from the exact source.`,
      );
      if (seen.has(referenceKey)) throw new Error(`${path}: duplicate note reference.`);
      seen.add(referenceKey);
      const interval = key === "noteRefs" ? scope : context;
      if (!intersects(ref, interval))
        throw new Error(
          `${path}.${key}: note is outside its declared ${key === "noteRefs" ? "scope" : "review context"}.`,
        );
    }
  }
  return input as ClaimV2["evidence"];
}

function intersects(note: StableNoteRefV1, range: TimeRangeV1): boolean {
  return note.kind === "long"
    ? note.startMs < range.endMs && note.endMs > range.startMs
    : note.startMs >= range.startMs && note.startMs < range.endMs;
}

function changed(
  document: ReviewDocumentV2,
  fields: Partial<ReviewDocumentV2>,
  human: boolean,
  options: OperationOptionsV2,
): ReviewDocumentV2 {
  return clone({
    ...document,
    ...fields,
    revision: document.revision + 1,
    reviewRevision: document.reviewRevision + (human ? 1 : 0),
    updatedAt: timestamp(options),
  });
}

function requireApproved(foundation: FoundationV2): void {
  if (foundation.approval.status !== "human-approved")
    throw new Error(
      "A human must approve the Foundation and its calibration examples before confirming observations.",
    );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function timestamp(options: { readonly now?: () => string }): string {
  return options.now?.() ?? new Date().toISOString();
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

function record(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): Record<string, unknown> {
  const result = object(value, path);
  for (const key of required)
    if (!(key in result)) throw new TypeError(`${path}.${key} is required.`);
  for (const key of Object.keys(result))
    if (!required.includes(key) && !optional.includes(key))
      throw new TypeError(`${path}.${key} is not an allowed field.`);
  return result;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value;
}

function assertSkillProvenance(input: unknown, path: string): void {
  const skill = record(input, ["name", "version", "sha256"], [], path);
  nonempty(skill.name, `${path}.name`);
  nonempty(skill.version, `${path}.version`);
  if (typeof skill.sha256 !== "string" || !/^[a-f\d]{64}$/.test(skill.sha256)) {
    throw new Error(`${path}.sha256 must be a SHA-256 digest.`);
  }
}

function nonempty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError(`${path} must be nonempty text.`);
}

function positiveInteger(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new TypeError(`${path} must be a positive integer.`);
}

function oneOf(value: unknown, values: readonly unknown[], path: string): void {
  if (!values.includes(value)) throw new TypeError(`${path} is unsupported.`);
}

function equal(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) throw new Error(`${path} does not match.`);
}

function same(left: unknown, right: unknown, message: string): void {
  if (serializeCanonicalJson(left) !== serializeCanonicalJson(right)) throw new Error(message);
}

function range(input: unknown, path: string): TimeRangeV1 {
  const value = record(input, ["startMs", "endMs"], [], path);
  if (
    typeof value.startMs !== "number" ||
    typeof value.endMs !== "number" ||
    !Number.isFinite(value.startMs) ||
    !Number.isFinite(value.endMs) ||
    value.startMs >= value.endMs
  )
    throw new Error(`${path} must be a nonempty source-time range.`);
  return { startMs: value.startMs, endMs: value.endMs };
}

function bytes(input: unknown, path: string): Uint8Array {
  const values = array(input, path);
  if (
    !values.every(
      (value) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255,
    )
  )
    throw new Error(`${path} must contain exact byte values.`);
  return Uint8Array.from(values as number[]);
}

function assertBase(input: unknown, path: string): void {
  const base = record(input, ["revision", "sha256"], [], path);
  positiveInteger(base.revision, `${path}.revision`);
  if (typeof base.sha256 !== "string" || !/^[a-f\d]{64}$/.test(base.sha256))
    throw new Error(`${path}.sha256 must be a SHA-256 digest.`);
}

function uniqueIds(values: readonly unknown[], path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const id = object(value, path).id;
    nonempty(id, `${path}.id`);
    if (seen.has(id)) throw new Error(`${path} has duplicate IDs.`);
    seen.add(id);
  }
}

function exactCoverage(
  values: readonly unknown[],
  key: string,
  expectedIds: readonly string[],
  path: string,
): void {
  const ids = values.map((value) => object(value, path)[key]);
  if (
    new Set(ids).size !== ids.length ||
    ids.length !== expectedIds.length ||
    expectedIds.some((id) => !ids.includes(id))
  ) {
    throw new Error(
      `${path} must cover every original ${key === "claimId" ? "claim" : "question"} exactly once.`,
    );
  }
}
