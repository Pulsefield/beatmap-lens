import { describe, expect, it } from "vitest";
import type { AgentProvenanceV2 } from "./contracts";
import type { InboxClaimV2 } from "./remote-workspace";
import {
  agentVersionLabel,
  matchesReviewVersions,
  reviewVersionOptions,
  skillKey,
} from "./review-provenance";

const agent = (name: string, version: string): AgentProvenanceV2 => ({
  producerId: `${name}-${version}`,
  role: "labeler",
  skill: { name, version, sha256: "a".repeat(64) },
});

const claim = (provenance: AgentProvenanceV2): InboxClaimV2 => ({
  handoffId: "handoff",
  claimId: provenance.producerId,
  status: "agent-reviewed",
  rationale: "Source organization supports this assessment.",
  tagId: "tech",
  scope: { startMs: 1000, endMs: 2000 },
  agent: provenance,
});

describe("review version provenance", () => {
  it("keeps different skill names with equal revisions and content separately selectable", () => {
    const first = agent("judgment", "v1");
    const second = agent("judgment-calibration", "v1");
    const claims = [claim(first), claim(second)];
    expect(reviewVersionOptions(claims, "labeler").map((option) => option.label)).toEqual([
      "judgment-calibration · v1 · aaaaaaaa",
      "judgment · v1 · aaaaaaaa",
    ]);
    expect(
      claims.filter((item) => matchesReviewVersions(item, { labelerVersion: skillKey(first) })),
    ).toEqual([claims[0]]);
    expect(agentVersionLabel()).toBe("Unversioned");
  });

  it("counts each auditor revision once per claim while retaining saved content groups", () => {
    const first = { ...agent("judgment", "v1"), role: "auditor" as const };
    const second = { ...agent("judgment", "v2"), role: "auditor" as const };
    const audited: InboxClaimV2 = {
      ...claim(agent("judgment", "v3")),
      audits: [first, first, second].map((provenance, index) => ({
        auditId: `audit-${index}`,
        agent: provenance,
        createdAt: `2026-09-09T10:00:0${index}Z`,
        outcome: "supported",
      })),
    };
    expect(reviewVersionOptions([audited], "auditor")).toEqual([
      {
        key: skillKey(second),
        label: "judgment · v2 · aaaaaaaa",
        count: 1,
        latest: "2026-09-09T10:00:02Z",
      },
      {
        key: skillKey(first),
        label: "judgment · v1 · aaaaaaaa",
        count: 1,
        latest: "2026-09-09T10:00:01Z",
      },
    ]);
    expect(matchesReviewVersions(audited, { auditorVersion: "a".repeat(64) })).toBe(true);
    expect(matchesReviewVersions(audited, { auditorVersion: skillKey(second) })).toBe(true);
    expect(
      matchesReviewVersions(audited, { auditorVersion: skillKey(agent("judgment", "v3")) }),
    ).toBe(false);
  });
});
