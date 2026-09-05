import { expect, it } from "vitest";
import { serializeCanonicalJson } from "../canonical-json";
import { inspectOsuSourceV1 } from "../source-identity";
import { createStableNoteRefsV1 } from "../stable-note-ref";
import type { ClaimV2 } from "./contracts";
import { assertClaimV2, assertFoundationV2 } from "./domain";
import { createExperimentalFoundationV2 } from "./experimental-campaign";
import { createQueryPilotFoundationV2 } from "./query-campaign";
import { NOW } from "./test-fixtures";

it("represents unresolved Drill in a separate proposed pilot without changing or inheriting the historical Foundation", async () => {
  const historical = createExperimentalFoundationV2(NOW);
  const historicalBytes = serializeCanonicalJson(historical);
  const foundation = await assertFoundationV2(createQueryPilotFoundationV2(NOW));
  expect(foundation.foundationId).toBe("pulsefield-query-style-pilot");
  expect(foundation.revision).toBe(1);
  expect(foundation.approval).toEqual({ status: "proposed" });
  expect(foundation.calibrationExamples).toEqual([]);
  expect(foundation.tags.map((tag) => tag.id)).toEqual([
    "jack-organization",
    "stream-organization",
    "drill-organization",
    "tech",
    "ln-coordination",
  ]);

  const { chart } = await inspectOsuSourceV1(
    new TextEncoder().encode(`osu file format v14
[General]
Mode: 3
[Metadata]
Title: Fixed-group alternation fixture
Artist: Fixture
Creator: Fixture
Version: 4K
[Difficulty]
CircleSize: 4
[TimingPoints]
0,400,4,2,0,100,1,0
[HitObjects]
64,192,1000,1,0,0:0:0:0:
192,192,1000,1,0,0:0:0:0:
320,192,1200,1,0,0:0:0:0:
448,192,1200,1,0,0:0:0:0:
64,192,1400,1,0,0:0:0:0:
192,192,1400,1,0,0:0:0:0:
320,192,1600,1,0,0:0:0:0:
448,192,1600,1,0,0:0:0:0:
`),
  );
  const notes = createStableNoteRefsV1(chart);
  const claim: ClaimV2 = {
    id: "fixed-groups",
    tagId: "drill-organization",
    scope: { startMs: 1000, endMs: 1601 },
    reviewContext: { startMs: 0, endMs: 1601 },
    assessment: { presence: "unresolved" },
    evidence: {
      noteRefs: notes,
      contextNoteRefs: [],
      rationale:
        "Fixed disjoint groups {1,2} and {3,4} alternate A/B/A/B. These four rows alone do not settle Drill presence; speed and duration also require judgment.",
    },
  };
  expect(() => assertClaimV2(claim, notes, foundation)).not.toThrow();
  expect(() => assertClaimV2(claim, notes, historical)).toThrow("Unknown Foundation tag");
  expect(historical.foundationId).toBe("pulsefield-four-dimension-style-pilot");
  expect(historical.revision).toBe(2);
  expect(historical.tags.find((tag) => tag.id === "stream-organization")?.inclusionCues).toContain(
    "Three or more consecutive complete roll/burst groups establish prominent Stream organization in the local episode. Count complete groups from source evidence, preserve changes of flow direction, and distinguish exact source timing from any equal-spacing interpretation.",
  );
  expect(serializeCanonicalJson(createExperimentalFoundationV2(NOW))).toBe(historicalBytes);
});
