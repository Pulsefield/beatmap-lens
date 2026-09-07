import type { AgentProvenanceV2 } from "./contracts";
import type { InboxClaimV2 } from "./remote-workspace";

export interface ReviewVersionFilter {
  labelerVersion?: string;
  auditorVersion?: string;
}

export function skillKey(agent?: AgentProvenanceV2): string {
  return agent?.skill?.sha256 ?? "unversioned";
}

export function agentVersionLabel(agent?: AgentProvenanceV2): string {
  const skill = agent?.skill;
  if (!skill) return "Unversioned";
  const version = skill.version.replace(/[a-f0-9]{40}/g, (hash) => hash.slice(0, 8));
  return `${version} · ${skill.sha256.slice(0, 8)}`;
}

export function matchesReviewVersions(claim: InboxClaimV2, filter: ReviewVersionFilter): boolean {
  return (
    (!filter.labelerVersion || skillKey(claim.agent) === filter.labelerVersion) &&
    (!filter.auditorVersion ||
      (claim.audits ?? []).some((audit) => skillKey(audit.agent) === filter.auditorVersion))
  );
}

export function reviewVersionOptions(claims: readonly InboxClaimV2[], role: "labeler" | "auditor") {
  const options = new Map<string, { key: string; label: string; count: number; latest: string }>();
  for (const claim of claims) {
    const entries =
      role === "labeler"
        ? [{ agent: claim.agent, createdAt: claim.submittedAt ?? "" }]
        : (claim.audits ?? []);
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = skillKey(entry.agent);
      const option = options.get(key) ?? {
        key,
        label: agentVersionLabel(entry.agent),
        count: 0,
        latest: "",
      };
      if (!seen.has(key)) option.count++;
      if (entry.createdAt > option.latest) option.latest = entry.createdAt;
      options.set(key, option);
      seen.add(key);
    }
  }
  return [...options.values()].sort(
    (a, b) => b.latest.localeCompare(a.latest) || a.key.localeCompare(b.key),
  );
}

/** Sampling can deduplicate within one provenance group, never across versions. */
export function reviewVersionKey(claim: InboxClaimV2): string {
  return JSON.stringify([
    skillKey(claim.agent),
    [...new Set((claim.audits ?? []).map((audit) => skillKey(audit.agent)))].sort(),
  ]);
}

export function auditVersionLabel(claim: InboxClaimV2): string {
  return (
    [...new Set((claim.audits ?? []).map((audit) => agentVersionLabel(audit.agent)))].join("; ") ||
    "No audit"
  );
}
