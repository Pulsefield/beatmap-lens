import { FOUNDATION_CONTRACT_V2, type FoundationTagV2, type FoundationV2 } from "./contracts";

const catalogueUrl = "https://osu.ppy.sh/wiki/en/Beatmap/Beatmap_tags";

// Local expert guidance from 2026-09-05; unresolved taxonomy choices remain explicit.
const tags: readonly FoundationTagV2[] = [
  {
    id: "jumpstream",
    displayName: "Jumpstream",
    definition:
      "A local tapping episode in which single-note stream motion incorporates recurring two-key chords. Its scope follows that organization and ends when the sequence becomes sustained group alternation or rolls. Short LNs can participate as extended-tap articulation while retaining their source kind and occupancy.",
    inclusionCues: [
      "Inspect recurring two-key chords together with the intervening single-note motion.",
      "Show entry, continuation, and the change into a different organization; context can extend beyond the claim.",
      "Interpret short LN articulation without converting source holds into taps or requiring an LN-focused label.",
    ],
    exclusionCues: [
      "An isolated two-note chord does not establish jumpstream.",
      "Two consecutive single notes are not a two-note chord.",
      "Sustained alternation of left and right two-key groups is the reviewed jumptrill countercase; following rolls do not extend the jumpstream episode.",
    ],
    communityAlignment: {
      catalogueUrl,
      externalTagId: "style/jumpstream",
      relation: "aligned",
      scope: "Section-local stream/chord structure; no inference from difficulty-level votes.",
    },
  },
  {
    id: "chordjack",
    displayName: "Chordjack",
    definition:
      "A local judgment of sustained chord-and-jack organization, distinguished from fixed-group long jump jacks. The reviewed typical case has changing three-key chords without a longjack anchor. Whether absence of an anchor is generally necessary remains unresolved.",
    inclusionCues: [
      "Compare the chord-group sequence and each column's recurrence with the reviewed changing-chord positive and fixed-group long jump jack countercase.",
      "Describe any longjack anchor explicitly and ask about anchored borderline arrangements until the general condition is settled.",
    ],
    exclusionCues: [
      "Chords on disjoint columns do not establish a jack relation.",
      "Shared columns between adjacent chord rows are insufficient: this shortcut misclassifies fixed-group long jump jacks.",
      "The reviewed three-key positive does not establish that chordjack universally requires exactly three keys.",
    ],
    communityAlignment: {
      catalogueUrl,
      externalTagId: "style/chordjack",
      relation: "related",
      scope:
        "Local expert discrimination separates fixed-group long jump jacks from the reviewed changing-chord case. The general necessity of having no longjack anchor remains pending; catalogue chord recurrence alone does not settle this judgment.",
    },
  },
  {
    id: "longjack",
    displayName: "Longjack",
    definition:
      "For this local calibration, a run of at least four fast, evenly spaced attacks on the same column. Repeating a fixed two-key group in this way forms a long jump jack. Long describes attack repetition, not a held note's duration.",
    inclusionCues: [
      "Count the repeated attacks and show their source intervals; the four-attack criterion is local expert guidance.",
      "Retain the run's entry and reset. A rhythm adjustment can separate two long jump jack runs.",
      "No numerical speed threshold or timing tolerance has been supplied; compare calibrated examples and leave marginal cases unresolved.",
    ],
    exclusionCues: [
      "A single long note is not a longjack.",
      "A two-attack minijack does not become longjack because surrounding notes increase the crop's total count.",
    ],
    communityAlignment: {
      catalogueUrl,
      externalTagId: "style/longjack",
      relation: "related",
      scope:
        "Local guidance uses at least four fast, evenly spaced same-column attacks and recognizes the fixed two-key long jump jack composite. This is not a universal catalogue threshold; speed and spacing tolerances remain unspecified.",
    },
  },
  {
    id: "ln-coordination",
    displayName: "LN coordination",
    definition:
      "An arrangement characterized by independently timed presses and releases across held columns, including new holds, releases in other columns, or taps during occupancy. Judge the precise control implied by this organization from complete source holds and event order.",
    inclusionCues: [
      "Inspect a new LN, another column's release, or a tap while multiple columns remain occupied.",
      "Explain the independent press/release relationships without inventing a measured player-demand trajectory.",
      "Entry context includes holds beginning before the claim when they remain occupied inside it.",
    ],
    exclusionCues: [
      "Simultaneous holds with no additional interacting activity are insufficient by themselves.",
      "Long-note presence alone does not establish coordination organization.",
    ],
    communityAlignment: {
      catalogueUrl,
      externalTagId: "style/LN coordination",
      relation: "aligned",
      scope: "Concurrent hold and attack relationships; no inferred player demand trajectory.",
    },
  },
  {
    id: "ln-release",
    displayName: "LN release",
    definition:
      "An arrangement characterized by staggered long-note releases, requiring different fingers to release at different moments. Compare separate releases with shared endings and with the columns still held at those moments.",
    inclusionCues: [
      "Show which columns release separately and which release together, retaining the complete source holds.",
      "Evidence connects each relevant release to its complete source hold and nearby events.",
      "Frequent shared endings can make an example weak or non-typical while some staggered release organization remains; keep typicality, presence, and salience separate.",
    ],
    exclusionCues: [
      "An isolated pair starting and ending together does not establish staggered release organization.",
      "A cropped display edge is not a source release event.",
    ],
    communityAlignment: {
      catalogueUrl,
      externalTagId: "style/LN release",
      relation: "related",
      scope:
        "Local expert guidance distinguishes staggered finger releases from shared endings; the catalogue wording does not supply this full discrimination or an extent threshold.",
    },
  },
  {
    id: "ln-inverse",
    displayName: "LN inverse",
    definition:
      "A section organized by interruptions and renewals of sustained long-note occupancy, where gaps between holds carry the pattern. Judge occupied and released intervals together.",
    inclusionCues: [
      "Repeated gaps interrupt a sustained hold field and structure its continuation.",
      "Witnesses include the releases, intervening gaps, and subsequent hold starts.",
    ],
    exclusionCues: [
      "Dense long-note starts without a gap-based organization are insufficient.",
      "A single rest or release alone does not establish inverse.",
    ],
    communityAlignment: {
      catalogueUrl,
      externalTagId: "gimmick/LN inverse",
      relation: "aligned",
      scope: "Section-local hold/gap organization, including occupancy entering the section.",
    },
  },
  {
    id: "tech",
    displayName: "Tech",
    definition:
      "A mapper concept for a tricky arrangement that disrupts an understandable regular pattern: attacks may be added or omitted relative to a locally established expectation, rhythm may vary, or short LNs may change articulation. Explain the concrete sequence that creates this character within the judged episode.",
    inclusionCues: [
      "Compare the observed sequence with an understandable local motif and identify the timing, attack, or articulation changes that make it tricky.",
      "An expected-note comparison explains organization; it does not assert a mapper error, hidden intention, or missing required musical event.",
      "Locate where the technical organization begins. A weak Tech positive can coexist with LN organization without making every LN passage Tech.",
    ],
    exclusionCues: [
      "Failure to identify another concept is not evidence for tech.",
      "The reviewed regular, easily controlled chordstream-like arrangement is a negative countercase; changing chords alone are insufficient.",
      "Complex snap, general density, visual clutter, or difficulty alone does not settle the local judgment.",
      "An unfamiliar arrangement stays unresolved when the local semantic boundary is unclear.",
    ],
    communityAlignment: {
      catalogueUrl,
      externalTagId: "skillset/tech",
      relation: "broader",
      scope:
        "The osu!mania catalogue emphasizes frequent complex snaps. This proposed mapper concept is broader; it is not equivalent to tech/complex snap, an exclusive class, or the complement of streams and jacks. Its boundary requires human-approved examples.",
    },
  },
  {
    id: "streams",
    displayName: "Streams",
    definition:
      "A local stream episode judged by its tapping organization and persistence. Continuing activity into a following jumptrill, roll, or jack episode does not extend the stream claim. A separate broad-family interpretation remains under discussion.",
    inclusionCues: [
      "Inspect entry, continuation, and changes in organization rather than only attack count or uninterrupted activity.",
      "Independent labels must be valid within the same judged episode; successive local patterns do not automatically establish co-occurrence.",
    ],
    exclusionCues: [
      "Following grouped trills, rolls, or jack episodes are not streams solely because tapping continues.",
      "Too few notes can leave a section assessment unresolved; insufficient evidence does not establish absence.",
      "Fast tempo or a large total note count alone does not establish local stream organization.",
    ],
    communityAlignment: {
      catalogueUrl,
      externalTagId: "skillset/streams",
      relation: "related",
      scope:
        "The catalogue describes continuous hits with a typical count above nine. Local expert review distinguishes stream episodes from subsequent trills, rolls, and jacks; a separate broad-family meaning remains pending, and no count-based classifier is implied.",
    },
  },
  {
    id: "speedjack",
    displayName: "Speedjack",
    definition:
      "A jack characterization in which short inter-attack spacing makes speed central to playing repeated-column attacks. Brief run length does not define it, and long runs are not excluded solely by length. Its standalone campaign target status remains under reconsideration.",
    inclusionCues: [
      "Establish the jack relationship, show actual source intervals, and compare the speed character with calibrated examples without inventing a numerical threshold.",
      "The reviewed minijack can be a non-typical speedjack example; assess presence, salience, and typicality independently.",
    ],
    exclusionCues: [
      "A fast alternating sequence without repeated-column attacks is insufficient.",
      "Neither a brief run, high BPM, nor the name minijack alone settles speedjack.",
    ],
    communityAlignment: {
      catalogueUrl,
      externalTagId: "skillset/speedjack",
      relation: "related",
      scope:
        "Local expert guidance emphasizes short inter-attack spacing and does not exclude long runs. The catalogue emphasizes shorter sequences. Independent target status remains pending; no automatic equivalence to minijack or wrist technique is asserted.",
    },
  },
];

export function createCampaignFoundationV2(createdAt: string): FoundationV2 {
  return {
    contract: FOUNDATION_CONTRACT_V2,
    version: 2,
    foundationId: "pulsefield-section-style",
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
