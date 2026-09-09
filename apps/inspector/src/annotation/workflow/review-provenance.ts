import type { AgentProvenanceV2 } from "./contracts";
import type { InboxClaimV2 } from "./remote-workspace";

export interface ReviewVersionFilter {
  labelerVersion?: string;
  auditorVersion?: string;
}

export function skillKey(agent?: AgentProvenanceV2): string {
  const skill = agent?.skill;
  return skill ? JSON.stringify([skill.name, skill.version, skill.sha256]) : "unversioned";
}

export function agentVersionLabel(agent?: AgentProvenanceV2): string {
  const skill = agent?.skill;
  if (!skill) return "Unversioned";
  const version = skill.version.replace(/[a-f0-9]{40}/g, (hash) => hash.slice(0, 8));
  return `${skill.name} · ${version} · ${skill.sha256.slice(0, 8)}`;
}

function matchesSkillVersion(agent: AgentProvenanceV2 | undefined, version: string): boolean {
  // Saved sample batches used content hashes before version identity included name and revision.
  return skillKey(agent) === version || agent?.skill?.sha256 === version;
}

export function matchesReviewVersions(claim: InboxClaimV2, filter: ReviewVersionFilter): boolean {
  const { labelerVersion, auditorVersion } = filter;
  return (
    (!labelerVersion || matchesSkillVersion(claim.agent, labelerVersion)) &&
    (!auditorVersion ||
      (claim.audits ?? []).some((audit) => matchesSkillVersion(audit.agent, auditorVersion)))
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
