import { FOUNDATION_CONTRACT_V2, type FoundationTagV2, type FoundationV2 } from "./contracts";

const tags: readonly FoundationTagV2[] = [
  {
    id: "jack-organization",
    displayName: "Jack organization",
    definition:
      "A local judgment of how repeated attacks on the same columns organize the episode, including fixed-group long jump jacks and changing-chord jack arrangements. Preserve their distinct pattern identities while judging the section's independent jack salience.",
    inclusionCues: [
      "Compare fixed-group long jump jacks, changing chord arrangements, and localized minijacks without merging their pattern identities.",
      "Use the complete recurrence sequence and entry context; count and timing are source facts, while section salience is a semantic judgment.",
      "The expert accepted fixed-group long jump jack as prominent broad Jack organization and the changing-chord comparator as typical jack/chordjack, not longjack.",
    ],
    exclusionCues: [
      "An isolated chord, dense tapping, or ordered motion across distinct columns does not establish jack organization.",
      "A localized minijack does not automatically make a larger section prominently jack-organized.",
      "A positive does not decide chordjack versus longjack, imply a speed threshold, or measure gameplay demand.",
    ],
    communityAlignments: [],
  },
  {
    id: "stream-organization",
    displayName: "Stream organization",
    definition:
      "A local judgment of recognizable flowing note motion, including jumpstream and directional roll/burst organization. Interpret incorporated jumps and short-LN articulation within the flow, preserve changes of organization and direction, and exclude the reviewed left/right two-hand grouped alternation called jumpdrill by the expert.",
    inclusionCues: [
      "The reviewed jumpstream and directional roll/burst episodes are positive Stream organization examples; explain the flow rather than relying on continuous activity.",
      "Inspect continuation, chord placement, rhythm, and resets, retaining complete short-LN source occupancy.",
      "A roll/burst group contains exactly four notes moving in one direction across columns, with equal adjacent-note spacing and no jump/chord relation bridging consecutive bursts. Burst is the faster roll description, without an invented speed threshold.",
      "Three or more consecutive complete roll/burst groups establish prominent Stream organization in the local episode. Count complete groups from source evidence, preserve changes of flow direction, and distinguish exact source timing from any equal-spacing interpretation.",
    ],
    exclusionCues: [
      "Continuous activity or a large note count alone does not establish the semantic organization.",
      "The reviewed alternating left/right two-key groups are jumpdrill and explicitly Stream absent. The expert's salience 0 is represented as absence, not a new numerical salience level.",
      "Do not extend a reviewed stream scope across different episodes merely because the display crop includes them.",
      "This local concept is not automatically the catalogue's skillset/streams definition or a union of every tapping pattern.",
    ],
    communityAlignments: [],
  },
  {
    id: "tech",
    displayName: "Tech",
    definition:
      "A tricky local arrangement that disrupts an understandable regular pattern through added or omitted expected attacks, rhythm variation, or articulation such as short LNs. Explain the concrete sequence and comparison that create its technical character.",
    inclusionCues: [
      "Identify the local motif, the actual departures from it, and the interval in which those departures characterize the arrangement.",
      "Preserve weak but certain positives separately from uncertainty and example typicality.",
      "Tech can coexist with independently supported jack, stream, or LN coordination judgments.",
    ],
    exclusionCues: [
      "An expected-note comparison is not an assertion of mapper error, hidden intent, or an unobserved musical event.",
      "Regular chordstream-like activity, density, complex snap, or unfamiliarity alone does not settle this judgment.",
      "Failure to identify another concept is not positive Tech evidence.",
    ],
    communityAlignments: [],
  },
  {
    id: "ln-coordination",
    displayName: "LN coordination",
    definition:
      "A local arrangement characterized by independently timed presses, releases, and taps interacting across occupied columns. Judge the coordination organization from complete source holds and the order of interacting events.",
    inclusionCues: [
      "Inspect a new hold, another column's release, or a tap while other columns remain occupied.",
      "Include holds beginning before the scope when their occupancy explains events inside it.",
      "Describe the independent control relationship; numerical frontier response and player-specific difficulty are not annotation targets.",
    ],
    exclusionCues: [
      "Long-note presence or simultaneous holds without additional interacting activity is insufficient by itself.",
      "Short LN articulation in a tapping passage does not automatically establish coordination-focused organization.",
      "LN release and inverse remain distinct descriptions; neither is automatically inferred as another supervised target.",
    ],
    communityAlignments: [],
  },
];

export function createExperimentalFoundationV2(createdAt: string): FoundationV2 {
  return {
    contract: FOUNDATION_CONTRACT_V2,
    version: 2,
    foundationId: "pulsefield-four-dimension-style-pilot",
    revision: 2,
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
