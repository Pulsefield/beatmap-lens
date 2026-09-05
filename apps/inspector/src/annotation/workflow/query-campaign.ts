import { FOUNDATION_CONTRACT_V2, type FoundationTagV2, type FoundationV2 } from "./contracts";

const sharedCues = [
  "Supporting/prominent express the strength of the target style. Typicality can inform that strength; coverage or duration alone does not decide it.",
  "Pattern witnesses may select only part of the source notes. Preserve the remaining notes and entering holds as context, check them for counterevidence, and hand uncertain selection or salience to an agent.",
  "Judge continuity through the dominant organization: an intervening row may be part of the pattern or mark a mini-section boundary. There is no blanket row-skipping rule.",
  "Preserve raw osu! times. Differences from 1 ms quantization that do not change the pattern need no separate expert question; no universal numerical tolerance is assumed.",
];

const tags: readonly FoundationTagV2[] = [
  {
    id: "jack-organization",
    displayName: "Jack organization",
    definition:
      "Repeated attacks on the same columns organize the local episode. Judge the recurrence sequence without using speed alone, retaining the distinction between fixed-group jacks, changing-chord arrangements, and localized repetitions.",
    inclusionCues: [
      "Explain which columns recur and how their recurrence organizes the selected scope.",
      "Slow recurrence around 400 ms can be a positive Jack countercase; speed alone does not determine presence or salience.",
      ...sharedCues,
    ],
    exclusionCues: [
      "Pure fixed, disjoint A/B Drill with no repeated columns between adjacent attack rows is broad Jack absent, even though each column returns two rows later.",
      "An isolated repetition does not automatically establish prominent Jack organization across a larger section.",
      "Density, chord size, or a gameplay difficulty estimate is insufficient by itself.",
    ],
    communityAlignments: [],
  },
  {
    id: "stream-organization",
    displayName: "Stream organization",
    definition:
      "Recognizable flowing note motion organizes the local episode, including stream, jumpstream, and directional roll or burst passages. Explain continuity, direction, chord placement, and resets in the actual sequence.",
    inclusionCues: [
      "Inspect the complete local flow and its entry and exit, preserving changes of organization.",
      "Directional roll groups can support a Stream judgment, while salience remains a separate judgment of this episode.",
      "A local 4K roll group has four notes moving across successive columns in one direction with evenly spaced rhythm, retaining raw source times and no jump/chord bridge between groups. Burst is the faster description without a supplied speed threshold.",
      "Three or more consecutive complete roll groups establish prominent roll structure, not automatic Stream prominence.",
      ...sharedCues,
    ],
    exclusionCues: [
      "A roll-group count does not automatically establish prominent Stream organization; no numerical count-to-salience rule is supplied for this pilot.",
      "Continuous activity, density, or fixed-group A/B alternation alone is insufficient to establish flowing Stream organization.",
      "The reviewed pure left/right-pair and crossed-pair Drill episodes are Stream absent. Do not extend a Stream scope through them simply because the surrounding crop has continuous activity.",
    ],
    communityAlignments: [],
  },
  {
    id: "drill-organization",
    displayName: "Drill organization",
    definition:
      "Two fixed, disjoint column groups repeatedly alternate A/B/A/B within the local episode. Each group may be a single key or a chord; both same-hand and cross-hand alternation are included.",
    inclusionCues: [
      "Identify the exact membership of groups A and B and show their recurring alternation from source attacks.",
      "Presence must consider both speed and duration in the selected episode; no numerical speed, duration, or repetition-count threshold is supplied.",
      ...sharedCues,
    ],
    exclusionCues: [
      "Four A/B/A/B attack rows alone are insufficient to establish Drill presence.",
      "Changing group membership, overlapping groups, or repeated attacks on only one group do not by themselves establish this fixed, disjoint A/B organization.",
      "A hand switch alone does not establish Drill, and same-hand organization does not exclude it.",
    ],
    communityAlignments: [],
  },
  {
    id: "tech",
    displayName: "Tech",
    definition:
      "A local arrangement that is hard to anticipate or follow through familiar patterns. Explain how the concrete sequence, rhythm, or articulation relationships create this character rather than treating generic variation as the target.",
    inclusionCues: [
      "An ideal-pattern comparison can explain added or omitted expected attacks or other departures; it is an optional explanation method, not a required template-first procedure.",
      "Preserve weak but certain positives separately from uncertainty; Tech may coexist with other independently supported targets.",
      ...sharedCues,
    ],
    exclusionCues: [
      "Variation, irregularity, or regularity alone is insufficient to settle Tech presence or absence.",
      "Density, reviewer unfamiliarity, complex snap, or failure to identify another target is not sufficient positive evidence.",
      "An expected-attack comparison does not assert mapper error or hidden musical intent.",
    ],
    communityAlignments: [],
  },
  {
    id: "ln-coordination",
    displayName: "LN coordination",
    definition:
      "Coordinated presses, releases, and taps across occupied columns characterize the local episode. At some instant, at least two columns must be occupied by LNs; this necessary condition is not sufficient. Explain the independent control relationships using complete source holds and the order of interacting events.",
    inclusionCues: [
      "Inspect how presses, releases, and taps interact, including holds that enter from before the scope.",
      "Use exact LN occupancy as evidence for the arrangement-level judgment, preserving short-LN articulation and release timing.",
      "No required LN percentage or fraction of the episode is supplied.",
      ...sharedCues,
    ],
    exclusionCues: [
      "Exact temporal overlap, LN presence, or simultaneous holds alone is insufficient to establish LN coordination.",
      "One held column with taps on all other columns generally is not LN coordination. Regular synchronized interactions or a 1 ms overlap alone do not establish a positive.",
      "A tap during a hold or short-LN articulation does not automatically establish coordination-focused organization.",
      "Player-specific difficulty and numerical control demand are not annotation targets.",
    ],
    communityAlignments: [],
  },
];

export function createQueryPilotFoundationV2(createdAt: string): FoundationV2 {
  return {
    contract: FOUNDATION_CONTRACT_V2,
    version: 2,
    foundationId: "pulsefield-query-style-pilot",
    revision: 1,
    createdAt,
    policies: {
      coordinates: "source-ms",
      rangeConvention: "half-open",
      datasetSemantics: "partially-exhaustive",
      collectionPolicy: "positive-first",
      saliencePolicy: "independent-per-tag-multiple-prominent",
      missingAssessment: "unreviewed-not-negative",
    },
    tags,
    calibrationExamples: [],
    approval: { status: "proposed" },
  };
}
